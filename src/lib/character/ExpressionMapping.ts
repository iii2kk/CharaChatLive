import {
  type SemanticMappingOption,
  SEMANTIC_EXPRESSION_KEYS,
  type ExpressionMapping,
  type SemanticExpressionKey,
  type SemanticExpressionMappingSnapshot,
} from "./types";

export class MutableExpressionMapping implements ExpressionMapping {
  blink: string | null = null;
  blinkLeft: string | null = null;
  blinkRight: string | null = null;
  aa: string | null = null;
  ih: string | null = null;
  ou: string | null = null;
  ee: string | null = null;
  oh: string | null = null;

  private listeners = new Set<() => void>();
  private options: Partial<Record<SemanticExpressionKey, readonly SemanticMappingOption[]>>;

  constructor(
    initial?: Partial<SemanticExpressionMappingSnapshot>,
    options?: Partial<Record<SemanticExpressionKey, readonly SemanticMappingOption[]>>
  ) {
    if (initial) {
      for (const key of SEMANTIC_EXPRESSION_KEYS) {
        const value = initial[key];
        if (typeof value === "string" || value === null) {
          this[key] = value;
        }
      }
    }
    this.options = options ?? {};
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  set(key: SemanticExpressionKey, name: string | null): void {
    if (this[key] === name) return;
    this[key] = name;
    this.notify();
  }

  toJSON(): SemanticExpressionMappingSnapshot {
    return {
      blink: this.blink,
      blinkLeft: this.blinkLeft,
      blinkRight: this.blinkRight,
      aa: this.aa,
      ih: this.ih,
      ou: this.ou,
      ee: this.ee,
      oh: this.oh,
    };
  }

  getOptions(key: SemanticExpressionKey): readonly SemanticMappingOption[] {
    return this.options[key] ?? [];
  }

  private notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

/** ExpressionController に存在する名前のみ採用してマッピングを構築する。 */
export function buildAutoMapping(
  has: (name: string) => boolean
): MutableExpressionMapping {
  const candidates: Record<SemanticExpressionKey, string> = {
    blink: "blink",
    blinkLeft: "blinkLeft",
    blinkRight: "blinkRight",
    aa: "aa",
    ih: "ih",
    ou: "ou",
    ee: "ee",
    oh: "oh",
  };

  const initial: Partial<SemanticExpressionMappingSnapshot> = {};
  for (const key of SEMANTIC_EXPRESSION_KEYS) {
    const candidate = candidates[key];
    initial[key] = has(candidate) ? candidate : null;
  }
  return new MutableExpressionMapping(initial);
}
