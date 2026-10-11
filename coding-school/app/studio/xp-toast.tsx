"use client";

import { useEffect } from "react";
import styles from "./xp-toast.module.css";

export function XpToast({ xp, onDismiss }: { xp: number | null; onDismiss: () => void }) {
  useEffect(() => {
    if (xp === null) return;
    const timer = window.setTimeout(onDismiss, 3000);
    return () => window.clearTimeout(timer);
  }, [xp, onDismiss]);
  if (xp === null) return null;
  return <div className={styles.toast} role="status" aria-live="polite">+{xp} XP</div>;
}
