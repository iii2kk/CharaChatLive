export interface ModelFile {
  name: string;
  path: string;
}

export interface ModelEntry {
  folder: string;
  files: ModelFile[];
}
