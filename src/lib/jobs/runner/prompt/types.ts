export type PrFileStatus = 'added' | 'modified' | 'removed' | 'renamed' | 'copied' | 'unchanged';

export interface PrFileChange {
  filename: string;
  status: PrFileStatus;
  additions: number;
  deletions: number;
}

export interface PrData {
  title: string;
  body: string;
  author: string;
  baseRefName: string;
  headRefName: string;
  files: PrFileChange[];
  diff: string;
}
