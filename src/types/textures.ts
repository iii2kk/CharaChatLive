export interface TextureFile {
  name: string;
  path: string;
  isEquirect?: boolean;
}

export interface TextureEntry {
  folder: string;
  files: TextureFile[];
}

export interface TexturePresets {
  ground: TextureEntry[];
  background: TextureEntry[];
}
