import { useEffect, useRef, useState } from "react";
import type { WikiNote } from "@electron/ipc/types";

interface Props {
  note: WikiNote;
  onSave: (content: string) => Promise<void>;
}

export function NoteEditor({ note, onSave }: Props) {
  const [value, setValue] = useState(note.content);
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setValue(note.content);
  }, [note.content, note.slug]);

  function scheduleSave(): void {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      void onSave(value);
    }, 500);
  }

  return (
    <textarea
      value={value}
      className="trellis-input min-h-[360px] font-mono text-sm leading-7"
      onChange={(event) => setValue(event.target.value)}
      onBlur={scheduleSave}
    />
  );
}

