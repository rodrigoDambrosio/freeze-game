/**
 * useLetterboxRect.js
 *
 * The camera view uses object-fit: contain so the full capture is always
 * visible (never cropped), which can leave black bars on the sides or top/
 * bottom when the video's aspect ratio doesn't match the container. HUD
 * elements (badges, buttons, corner decorations) should sit only over the
 * actual visible video, not over those bars — this computes the inset of
 * that visible rect within the container, in pixels.
 */
import { useEffect, useState } from 'react';

const FULL_RECT = { top: 0, right: 0, bottom: 0, left: 0 };

export function useLetterboxRect(containerRef, videoRef, recomputeKey) {
  const [rect, setRect] = useState(FULL_RECT);

  useEffect(() => {
    const container = containerRef.current;
    const video = videoRef.current;
    if (!container || !video) return;

    const recompute = () => {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      if (!vw || !vh || !cw || !ch) {
        setRect(FULL_RECT);
        return;
      }

      const videoRatio = vw / vh;
      const containerRatio = cw / ch;

      if (videoRatio > containerRatio) {
        // Video is relatively wider than the container → fills width,
        // letterboxed top/bottom.
        const displayedHeight = cw / videoRatio;
        const bar = Math.max(0, (ch - displayedHeight) / 2);
        setRect({ top: bar, bottom: bar, left: 0, right: 0 });
      } else {
        // Fills height, letterboxed left/right.
        const displayedWidth = ch * videoRatio;
        const bar = Math.max(0, (cw - displayedWidth) / 2);
        setRect({ top: 0, bottom: 0, left: bar, right: bar });
      }
    };

    recompute();

    const resizeObserver = new ResizeObserver(recompute);
    resizeObserver.observe(container);
    video.addEventListener('loadedmetadata', recompute);
    video.addEventListener('resize', recompute);

    return () => {
      resizeObserver.disconnect();
      video.removeEventListener('loadedmetadata', recompute);
      video.removeEventListener('resize', recompute);
    };
  }, [containerRef, videoRef, recomputeKey]);

  return rect;
}
