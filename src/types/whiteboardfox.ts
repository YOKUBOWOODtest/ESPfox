export interface GalleryPost {
  /** Snapshot id on the source site. */
  id: number;
  /** Thumbnail file key (`postFileName`, falling back to the id). */
  file: string;
  likeCount: number;
  editorPick?: boolean;
  pinned?: boolean;
  byLine: string;
}

export interface GalleryPage {
  page: number;
  pageCount: number;
  totalCount: number;
  posts: GalleryPost[];
}
