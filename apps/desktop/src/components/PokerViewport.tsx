import { useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import './poker-fit.css';

/** Fits the whole poker page to the tablet's actual remaining space, never to the window. */
export function PokerViewport({ children }: { children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null),
    content = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({
    width: 1000,
    height: 700,
    arena: 430,
    scale: 1,
    tight: false,
  });
  useLayoutEffect(() => {
    const outer = frame.current,
      inner = content.current;
    if (!outer || !inner || typeof ResizeObserver === 'undefined') return;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const width = outer.clientWidth,
          height = outer.clientHeight;
        if (!width || !height) return;
        // Measure the controls separately: tall tablets should use their remaining
        // space for the felt, while short ones retain the compact side panel.
        const felt = inner.querySelector<HTMLElement>('.pkr-arena');
        const naturalHeight = inner.offsetHeight;
        const overhead = felt ? naturalHeight - felt.offsetHeight : 0;
        const arena = Math.max(width <= 680 ? 390 : 430, height - overhead - 4);
        const scale = Math.min(1, height / Math.max(1, naturalHeight));
        const tight = width > 680 && height < 600;
        setLayout((old) =>
          Math.abs(old.width - width) < 1 &&
          Math.abs(old.height - height) < 1 &&
          Math.abs(old.arena - arena) < 1 &&
          Math.abs(old.scale - scale) < 0.002 &&
          old.tight === tight
            ? old
            : { width, height, arena, scale, tight },
        );
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(inner);
    measure();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);
  return (
    <div ref={frame} className={`poker-viewport ${layout.tight ? 'poker-height-tight' : ''}`}>
      <div
        ref={content}
        className="poker-viewport-content"
        style={
          {
            width: layout.width,
            transform: `translateX(-50%) scale(${layout.scale})`,
            '--poker-fit-height': `${layout.height}px`,
            '--poker-fit-arena': `${layout.arena}px`,
          } as CSSProperties
        }
      >
        {children}
      </div>
    </div>
  );
}
