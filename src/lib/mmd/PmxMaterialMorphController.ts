import * as THREE from "three";
import type {
  PmxRawGroupMorph,
  PmxRawMaterialMorph,
  PmxRawMaterialMorphElement,
  PmxRawMorph,
} from "./types";

/**
 * Phase 1: applies PMX material morphs (type === 8) to Three.js materials.
 *
 * - Stores a snapshot of base material color/opacity/emissive/edgeColor
 * - On weight change, recomputes affected materials from snapshot + accumulated
 *   mul/add factors across all active material morphs (including group morphs
 *   that wrap material morphs).
 * - Pre-scans morphs to force `transparent` on materials whose alpha may drop
 *   below 1.0; otherwise the GPU ignores opacity changes.
 *
 * NOT supported in Phase 1 (TODO):
 *   - textureColor / sphereTextureColor / toonColor multipliers
 *   - shininess / edgeSize
 *   - additional UV morph types (4-7)
 *   - vertex / bone / uv morphs (those use other paths)
 */

interface MaterialLike {
  color?: THREE.Color;
  opacity?: number;
  transparent?: boolean;
  depthWrite?: boolean;
  emissive?: THREE.Color;
  userData?: Record<string, unknown>;
}

interface MaterialSnapshot {
  material: MaterialLike;
  baseColor: THREE.Color;
  baseOpacity: number;
  baseEmissive: THREE.Color | null;
  baseOutlineColor: THREE.Color | null;
  baseOutlineAlpha: number;
}

interface OutlineParameters {
  color?: THREE.Color | [number, number, number];
  alpha?: number;
  thickness?: number;
  visible?: boolean;
}

function getOutlineParams(material: MaterialLike): OutlineParameters | null {
  const params = material.userData?.outlineParameters as
    | OutlineParameters
    | undefined;
  return params ?? null;
}

function snapshotMaterial(material: MaterialLike): MaterialSnapshot {
  const outline = getOutlineParams(material);
  let baseOutlineColor: THREE.Color | null = null;
  if (outline?.color) {
    if (Array.isArray(outline.color)) {
      baseOutlineColor = new THREE.Color(
        outline.color[0],
        outline.color[1],
        outline.color[2]
      );
    } else {
      baseOutlineColor = outline.color.clone();
    }
  }
  return {
    material,
    baseColor: material.color
      ? material.color.clone()
      : new THREE.Color(1, 1, 1),
    baseOpacity: material.opacity ?? 1,
    baseEmissive: material.emissive ? material.emissive.clone() : null,
    baseOutlineColor,
    baseOutlineAlpha: outline?.alpha ?? 1,
  };
}

interface EffectiveElement {
  /** flattened material element (group ratio already folded into the contribution) */
  element: PmxRawMaterialMorphElement;
  /** weight multiplier from group nesting (1 for top-level material morphs) */
  ratio: number;
}

/**
 * Resolve a top-level morph into a flat list of (material element, ratio).
 * For type === 8: returns the element list with ratio=1.
 * For type === 0 (group): recurses into children that are material morphs.
 *   Non-material children are ignored (vertex morphs handled elsewhere).
 */
function resolveMaterialContributions(
  morph: PmxRawMorph,
  allMorphs: readonly PmxRawMorph[],
  ratio: number,
  out: EffectiveElement[],
  visited: Set<number> = new Set()
): void {
  if (morph.type === 8) {
    for (const e of morph.elements) {
      out.push({ element: e, ratio });
    }
    return;
  }
  if (morph.type === 0) {
    for (const child of (morph as PmxRawGroupMorph).elements) {
      if (visited.has(child.index)) continue;
      visited.add(child.index);
      const target = allMorphs[child.index];
      if (!target) continue;
      resolveMaterialContributions(
        target,
        allMorphs,
        ratio * child.ratio,
        out,
        visited
      );
      visited.delete(child.index);
    }
  }
}

export class PmxMaterialMorphController {
  /** material morph display name -> resolved element contributions */
  private contributions = new Map<string, EffectiveElement[]>();
  /** current weight per morph name */
  private weights = new Map<string, number>();
  /** snapshot of base properties per material index */
  private snapshots: MaterialSnapshot[] = [];
  /** indices of materials any active morph might affect */
  private affectedIndices = new Set<number>();

  constructor(
    materials: THREE.Material | THREE.Material[],
    materialMorphs: readonly PmxRawMaterialMorph[],
    groupMorphs: readonly PmxRawGroupMorph[],
    allMorphs: readonly PmxRawMorph[]
  ) {
    const matArray = (
      Array.isArray(materials) ? materials : [materials]
    ) as MaterialLike[];

    for (const m of matArray) {
      this.snapshots.push(snapshotMaterial(m));
    }

    const collect = (morph: PmxRawMaterialMorph | PmxRawGroupMorph) => {
      const out: EffectiveElement[] = [];
      resolveMaterialContributions(
        morph as PmxRawMorph,
        allMorphs,
        1,
        out,
        new Set([allMorphs.indexOf(morph as PmxRawMorph)])
      );
      if (out.length === 0) return;
      const name = morph.name;
      if (this.contributions.has(name)) {
        // Two morphs with the same name; merge contributions so neither is lost.
        this.contributions.get(name)!.push(...out);
      } else {
        this.contributions.set(name, out);
      }
      this.weights.set(name, 0);

      for (const c of out) {
        this.recordAffected(c.element.index, matArray.length);
      }
    };

    for (const m of materialMorphs) collect(m);
    for (const g of groupMorphs) collect(g);

    this.forceTransparentWhereNeeded(matArray);
  }

  private recordAffected(index: number, materialCount: number) {
    if (index === -1) {
      for (let i = 0; i < materialCount; i++) this.affectedIndices.add(i);
    } else if (index >= 0) {
      this.affectedIndices.add(index);
    }
  }

  private forceTransparentWhereNeeded(materials: MaterialLike[]) {
    for (const morph of this.contributions.values()) {
      for (const { element } of morph) {
        const willReduceAlpha =
          (element.type === 0 && element.diffuse[3] < 1) ||
          (element.type === 1 && element.diffuse[3] < 0);
        if (!willReduceAlpha) continue;
        const targets =
          element.index === -1 ? materials : [materials[element.index]];
        for (const t of targets) {
          if (!t) continue;
          t.transparent = true;
          // depthWrite=false is the safer default for typical PMX semi-transparent
          // surfaces (windows, glass). PMX itself doesn't expose this flag, but
          // mismatched depth writes cause obvious z-fighting on e.g. windows.
          t.depthWrite = false;
        }
      }
    }
  }

  hasMorph(name: string): boolean {
    return this.contributions.has(name);
  }

  listNames(): string[] {
    return Array.from(this.contributions.keys());
  }

  getWeight(name: string): number {
    return this.weights.get(name) ?? 0;
  }

  setWeight(name: string, weight: number): void {
    if (!this.contributions.has(name)) return;
    const clamped = Math.min(1, Math.max(0, weight));
    if (this.weights.get(name) === clamped) return;
    this.weights.set(name, clamped);
    this.recompute();
  }

  reset(): void {
    let changed = false;
    for (const [k, v] of this.weights) {
      if (v !== 0) {
        this.weights.set(k, 0);
        changed = true;
      }
    }
    if (changed) this.recompute();
  }

  /**
   * Re-evaluate all affected materials from base snapshots.
   * Called whenever any material morph weight changes.
   */
  private recompute(): void {
    // Per-material accumulators
    type Acc = {
      mulColor: THREE.Color;
      mulOpacity: number;
      addColor: THREE.Color;
      addOpacity: number;
      mulAmbient: THREE.Color;
      addAmbient: THREE.Color;
      mulEdgeColor: THREE.Color;
      mulEdgeAlpha: number;
      addEdgeColor: THREE.Color;
      addEdgeAlpha: number;
    };

    const accs = new Map<number, Acc>();
    const ensureAcc = (idx: number): Acc => {
      let a = accs.get(idx);
      if (!a) {
        a = {
          mulColor: new THREE.Color(1, 1, 1),
          mulOpacity: 1,
          addColor: new THREE.Color(0, 0, 0),
          addOpacity: 0,
          mulAmbient: new THREE.Color(1, 1, 1),
          addAmbient: new THREE.Color(0, 0, 0),
          mulEdgeColor: new THREE.Color(1, 1, 1),
          mulEdgeAlpha: 1,
          addEdgeColor: new THREE.Color(0, 0, 0),
          addEdgeAlpha: 0,
        };
        accs.set(idx, a);
      }
      return a;
    };

    for (const [name, weight] of this.weights) {
      if (weight === 0) continue;
      const contribs = this.contributions.get(name);
      if (!contribs) continue;
      for (const { element, ratio } of contribs) {
        const w = weight * ratio;
        if (w === 0) continue;
        const targetIndices: number[] =
          element.index === -1
            ? Array.from({ length: this.snapshots.length }, (_, i) => i)
            : [element.index];

        for (const idx of targetIndices) {
          if (idx < 0 || idx >= this.snapshots.length) continue;
          const acc = ensureAcc(idx);
          const d = element.diffuse;
          const am = element.ambient;
          const ec = element.edgeColor;

          if (element.type === 0) {
            // mul: lerp(1, factor, w)
            acc.mulColor.r *= 1 + (d[0] - 1) * w;
            acc.mulColor.g *= 1 + (d[1] - 1) * w;
            acc.mulColor.b *= 1 + (d[2] - 1) * w;
            acc.mulOpacity *= 1 + (d[3] - 1) * w;

            acc.mulAmbient.r *= 1 + (am[0] - 1) * w;
            acc.mulAmbient.g *= 1 + (am[1] - 1) * w;
            acc.mulAmbient.b *= 1 + (am[2] - 1) * w;

            acc.mulEdgeColor.r *= 1 + (ec[0] - 1) * w;
            acc.mulEdgeColor.g *= 1 + (ec[1] - 1) * w;
            acc.mulEdgeColor.b *= 1 + (ec[2] - 1) * w;
            acc.mulEdgeAlpha *= 1 + (ec[3] - 1) * w;
          } else {
            // add: factor * w
            acc.addColor.r += d[0] * w;
            acc.addColor.g += d[1] * w;
            acc.addColor.b += d[2] * w;
            acc.addOpacity += d[3] * w;

            acc.addAmbient.r += am[0] * w;
            acc.addAmbient.g += am[1] * w;
            acc.addAmbient.b += am[2] * w;

            acc.addEdgeColor.r += ec[0] * w;
            acc.addEdgeColor.g += ec[1] * w;
            acc.addEdgeColor.b += ec[2] * w;
            acc.addEdgeAlpha += ec[3] * w;
          }
        }
      }
    }

    // Apply to materials. Affected materials with no acc entry (=> all weights 0
    // or only inactive) revert to base snapshot.
    for (const idx of this.affectedIndices) {
      const snap = this.snapshots[idx];
      if (!snap) continue;
      const acc = accs.get(idx);
      const m = snap.material;
      if (!acc) {
        if (m.color) m.color.copy(snap.baseColor);
        if (m.opacity !== undefined) m.opacity = snap.baseOpacity;
        if (m.emissive && snap.baseEmissive) {
          m.emissive.copy(snap.baseEmissive);
        }
        const outline = getOutlineParams(m);
        if (outline && snap.baseOutlineColor) {
          if (outline.color instanceof THREE.Color) {
            outline.color.copy(snap.baseOutlineColor);
          }
          outline.alpha = snap.baseOutlineAlpha;
        }
        continue;
      }

      if (m.color) {
        m.color.r = snap.baseColor.r * acc.mulColor.r + acc.addColor.r;
        m.color.g = snap.baseColor.g * acc.mulColor.g + acc.addColor.g;
        m.color.b = snap.baseColor.b * acc.mulColor.b + acc.addColor.b;
      }
      if (m.opacity !== undefined) {
        m.opacity = Math.min(
          1,
          Math.max(0, snap.baseOpacity * acc.mulOpacity + acc.addOpacity)
        );
      }
      if (m.emissive && snap.baseEmissive) {
        m.emissive.r =
          snap.baseEmissive.r * acc.mulAmbient.r + acc.addAmbient.r;
        m.emissive.g =
          snap.baseEmissive.g * acc.mulAmbient.g + acc.addAmbient.g;
        m.emissive.b =
          snap.baseEmissive.b * acc.mulAmbient.b + acc.addAmbient.b;
      }
      const outline = getOutlineParams(m);
      if (outline && snap.baseOutlineColor) {
        if (outline.color instanceof THREE.Color) {
          outline.color.r =
            snap.baseOutlineColor.r * acc.mulEdgeColor.r + acc.addEdgeColor.r;
          outline.color.g =
            snap.baseOutlineColor.g * acc.mulEdgeColor.g + acc.addEdgeColor.g;
          outline.color.b =
            snap.baseOutlineColor.b * acc.mulEdgeColor.b + acc.addEdgeColor.b;
        }
        outline.alpha = Math.min(
          1,
          Math.max(
            0,
            snap.baseOutlineAlpha * acc.mulEdgeAlpha + acc.addEdgeAlpha
          )
        );
      }
    }
  }

  dispose(): void {
    this.contributions.clear();
    this.weights.clear();
    this.snapshots = [];
    this.affectedIndices.clear();
  }
}
