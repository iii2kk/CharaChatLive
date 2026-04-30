/**
 * PMX raw morph data types (subset relevant to material morphs in Phase 1).
 * Shape mirrors what mmd-parser's parsePmx() produces.
 */

export interface PmxRawMaterialMorphElement {
  /** Material index in `data.materials`. -1 means "all materials" */
  index: number;
  /** 0 = multiply, 1 = add */
  type: 0 | 1;
  /** RGBA */
  diffuse: ArrayLike<number>;
  /** RGB */
  specular: ArrayLike<number>;
  shininess: number;
  /** RGB */
  ambient: ArrayLike<number>;
  /** RGBA */
  edgeColor: ArrayLike<number>;
  edgeSize: number;
  /** RGBA — texture multiplier */
  textureColor: ArrayLike<number>;
  /** RGBA */
  sphereTextureColor: ArrayLike<number>;
  /** RGBA */
  toonColor: ArrayLike<number>;
}

export interface PmxRawGroupMorphElement {
  /** Index into `data.morphs` */
  index: number;
  ratio: number;
}

export interface PmxRawMorphBase {
  name: string;
  englishName: string;
  panel: number;
  elementCount: number;
}

export interface PmxRawMaterialMorph extends PmxRawMorphBase {
  type: 8;
  elements: PmxRawMaterialMorphElement[];
}

export interface PmxRawGroupMorph extends PmxRawMorphBase {
  type: 0;
  elements: PmxRawGroupMorphElement[];
}

export interface PmxRawOtherMorph extends PmxRawMorphBase {
  type: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  // elements shape depends on type; we don't introspect them in Phase 1
  elements: unknown[];
}

export type PmxRawMorph =
  | PmxRawMaterialMorph
  | PmxRawGroupMorph
  | PmxRawOtherMorph;

/** Subset of the parsed PMX structure we actually use. */
export interface PmxRawData {
  metadata: { morphCount: number; format: "pmx" | "pmd" };
  morphs: PmxRawMorph[];
}
