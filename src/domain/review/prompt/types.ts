import type { ReviewFile } from '../narrative.ts';

/** Everything the prompt builder needs to know about the change under review. */
export interface PrData {
  title: string;
  body: string;
  author: string;
  baseRefName: string;
  headRefName: string;
  files: ReviewFile[];
  diff: string;
}
