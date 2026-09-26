import mark from "@/assets/testra-mark.png";

/** Plain Vite resolves the image import to its URL (Astro's types say ImageMetadata). */
export const TESTRA_MARK = mark as unknown as string;
