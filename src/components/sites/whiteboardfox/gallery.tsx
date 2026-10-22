"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { DropdownMenu } from "./dropdown-menu";
import {
  galleryPageSize,
  galleryPosts,
  galleryTotalCount,
} from "./gallery-data";
import type { GalleryPost } from "@/types/whiteboardfox";

const TOTAL_PAGES = Math.ceil(galleryTotalCount / galleryPageSize);

/** Pages beyond the captured 3 reuse the capture, mirroring the paged API. */
function postsForPage(page: number): GalleryPost[] {
  const pages = Math.max(1, Math.floor(galleryPosts.length / galleryPageSize));
  return galleryPosts.slice(
    ((page - 1) % pages) * galleryPageSize,
    ((page - 1) % pages) * galleryPageSize + galleryPageSize,
  );
}

export function Gallery() {
  const posts = useMemo(() => postsForPage(1), []);

  return (
    <div className="mx-auto h-full w-[1010px] px-[50px] pb-[10px]">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap justify-between gap-4">
        <TopPosts posts={posts} />
      </div>
    </div>
  );
}

function TopPosts({ posts }: { posts: GalleryPost[] }) {
  const [page, setPage] = useState(1);
  const [pageData, setPageData] = useState({ page: 1, posts });
  const thinking = page !== pageData.page;

  // The source refetches per page and shows the top progress bar while in flight.
  useEffect(() => {
    if (page === pageData.page) {
      return;
    }
    const timer = window.setTimeout(() => {
      setPageData({ page, posts: postsForPage(page) });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [page, pageData.page]);

  const pagePosts = pageData.posts;

  return (
    <>
      <div
        className="fixed top-0 right-0 left-0 z-10 h-1.5 w-full overflow-hidden bg-[#eeeeee]"
        id="loading-bar"
        style={{ display: thinking ? "block" : "none" }}
      >
        <div
          className="h-full w-full bg-brand-soft"
          style={{ animation: "wf-progress 1s infinite linear", transformOrigin: "0% 50%" }}
        />
      </div>

      <div className="min-w-0 grow px-4 pb-2 lg:px-0">
        <div
          id="posts-container"
          className="flex flex-wrap items-stretch gap-6 rounded-[8px] bg-gray-100 p-6 ring-1 ring-gray-900/10"
        >
          {pagePosts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>

        <div
          id="pagination-container"
          className="mt-8 flex w-full items-center justify-between"
        >
          <div className="flex items-center text-sm font-medium text-gray-900">
            <select
              aria-label="Page"
              className="mr-3 rounded-[6px] border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-900 hover:bg-gray-50"
              value={page}
              onChange={(event) => setPage(Number(event.target.value))}
            >
              {Array.from({ length: TOTAL_PAGES }, (_, index) => index + 1).map(
                (value) => (
                  <option key={value} value={value}>
                    Page {value}
                  </option>
                ),
              )}
            </select>
            <span> of {TOTAL_PAGES}</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setPage((current) => current - 1)}
              disabled={page === 1 || thinking}
              className="rounded-[6px] bg-gray-200 px-3 py-2 text-center text-xs font-medium text-black hover:bg-gray-300 disabled:pointer-events-none disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((current) => current + 1)}
              disabled={page === TOTAL_PAGES || thinking}
              className="rounded-[6px] bg-gray-200 px-3 py-2 text-center text-xs font-medium text-black hover:bg-gray-300 disabled:pointer-events-none disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function PostCard({ post }: { post: GalleryPost }) {
  const [liked, setLiked] = useState(false);

  return (
    <div className="post-div relative flex h-full w-full flex-col items-start overflow-hidden rounded-[6px] border border-solid border-gray-200 bg-white shadow sm:w-[calc(50%-1rem)] md:w-[calc(33.33%-1rem)]">
      <a
        className="post-image-anchor relative block w-full"
        style={{ paddingTop: "52.5%" }}
        href={`/board/post-${post.id}`}
      >
        <Image
          src={`/sites/whiteboardfox/gallery/${post.file}.png`}
          alt="Post Thumbnail"
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, 261px"
          className="post-image object-cover"
        />
      </a>

      <div
        className={`post-pin absolute top-0 left-0 mt-2 ml-2 h-6 w-6 items-center justify-center ${
          post.pinned ? "flex" : "hidden"
        }`}
      >
        <PinIcon />
      </div>

      <DropdownMenu label={`Options for post ${post.id}`}>
        <button
          type="button"
          className="report-btn flex cursor-pointer items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
        >
          <ReportIcon />
          <span>Report NSFW</span>
        </button>
      </DropdownMenu>

      <div className="relative z-10 flex w-full items-center p-2">
        <p className="post-description flex-1 truncate text-sm" />
        <span className="flex items-center justify-end gap-1">
          <span
            id="is-editor-pick"
            title="Editor's Choice"
            className={`mr-1 ${post.editorPick ? "flex" : "hidden"}`}
          >
            <AwardIcon />
          </span>
          <button
            type="button"
            aria-label={liked ? "Unlike post" : "Like post"}
            aria-pressed={liked}
            className="heart-btn cursor-pointer disabled:opacity-70"
            onClick={() => setLiked((current) => !current)}
          >
            <HeartIcon liked={liked} />
          </button>
          <span className="post-like-count text-xs" />
        </span>
      </div>
    </div>
  );
}

/* Icons below are the source page's own inline SVGs, kept verbatim. */

function PinIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
      fill="#808080"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M4.146.146A.5.5 0 0 1 4.5 0h7a.5.5 0 0 1 .5.5c0 .68-.342 1.174-.646 1.479-.126.125-.25.224-.354.298v4.431l.078.048c.203.127.476.314.751.555C12.36 7.775 13 8.527 13 9.5a.5.5 0 0 1-.5.5h-4v4.5c0 .276-.224 1.5-.5 1.5s-.5-1.224-.5-1.5V10h-4a.5.5 0 0 1-.5-.5c0-.973.64-1.725 1.17-2.189A5.921 5.921 0 0 1 5 6.708V2.277a2.77 2.77 0 0 1-.354-.298C4.342 1.674 4 1.179 4 .5a.5.5 0 0 1 .146-.354z" />
    </svg>
  );
}


function ReportIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className="h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M12 10V13" stroke="#323232" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 16V15.9888" stroke="#323232" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M10.2518 5.147L3.6508 17.0287C2.91021 18.3618 3.87415 20 5.39912 20H18.6011C20.126 20 21.09 18.3618 20.3494 17.0287L13.7484 5.147C12.9864 3.77538 11.0138 3.77538 10.2518 5.147Z"
        stroke="#323232"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AwardIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 640 640"
      className="h-6 w-6"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M341.9 38.1C328.5 29.9 311.6 29.9 298.2 38.1C273.8 53 258.7 57 230.1 56.4C214.4 56 199.8 64.5 192.2 78.3C178.5 103.4 167.4 114.5 142.3 128.2C128.5 135.7 120.1 150.4 120.4 166.1C121.1 194.7 117 209.8 102.1 234.2C93.9 247.6 93.9 264.5 102.1 277.9C117 302.3 121 317.4 120.4 346C120 361.7 128.5 376.3 142.3 383.9C164.4 396 175.6 406 187.4 425.4L138.7 522.5C132.8 534.4 137.6 548.8 149.4 554.7L235.4 597.7C246.9 603.4 260.9 599.1 267.1 587.9L319.9 492.8L372.7 587.9C378.9 599.1 392.9 603.5 404.4 597.7L490.4 554.7C502.3 548.8 507.1 534.4 501.1 522.5L452.5 425.3C464.2 405.9 475.5 395.9 497.6 383.8C511.4 376.3 519.8 361.6 519.5 345.9C518.8 317.3 522.9 302.2 537.8 277.8C546 264.4 546 247.5 537.8 234.1C522.9 209.7 518.9 194.6 519.5 166C519.9 150.3 511.4 135.7 497.6 128.1C472.5 114.4 461.4 103.3 447.7 78.2C440.2 64.4 425.5 56 409.8 56.3C381.2 57 366.1 52.9 341.7 38zM320 160C373 160 416 203 416 256C416 309 373 352 320 352C267 352 224 309 224 256C224 203 267 160 320 160z" />
    </svg>
  );
}

function HeartIcon({ liked }: { liked: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      fill={liked ? "#F05252" : "none"}
      stroke={liked ? "#F05252" : "currentColor"}
      className="heart-svg h-6 w-6 cursor-pointer text-slate-500 ease-in hover:text-slate-900"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"
      />
    </svg>
  );
}
