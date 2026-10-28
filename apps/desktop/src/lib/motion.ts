import { useEffect, useRef, useState } from "react";

/**
 * Destaque rápido quando `key` muda (não no primeiro render): devolve a classe "anim-flash" por ~1 s.
 * Use uma chave primitiva com o que importa (ex.: `${task?.id}|${activity}`).
 */
export function useFlash(key: string | number | null | undefined): string {
  const prev = useRef(key);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (Object.is(prev.current, key)) return;
    prev.current = key;
    setOn(false);
    const raf = requestAnimationFrame(() => setOn(true));
    const t = setTimeout(() => setOn(false), 1100);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [key]);
  return on ? "anim-flash" : "";
}
