import { useEffect, useRef, useState } from "react";

interface Props {
  title: string;
  slug: string;
  onSaveTitle: (title: string, slug: string) => void | Promise<void>;
}

export function EditableNoteTitle({ title, slug, onSaveTitle }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(title);
    setEditing(false);
  }, [slug, title]);

  useEffect(() => {
    if (!editing || !inputRef.current) {
      return;
    }

    inputRef.current.focus();
    inputRef.current.select();
  }, [editing]);

  function commit(): void {
    const next = draft.trim();

    if (next.length < 1) {
      setDraft(title);
      setEditing(false);
      return;
    }

    if (next.length > 120) {
      setDraft(title);
      setEditing(false);
      return;
    }

    setEditing(false);

    if (next === title) {
      return;
    }

    void onSaveTitle(next, slug);
  }

  function cancel(): void {
    setDraft(title);
    setEditing(false);
  }

  if (editing) {
    return (
      <h1 className="trellis-document-title">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          maxLength={120}
          aria-label="Note title"
          className="trellis-document-title-input"
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onBlur={() => {
            commit();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }

            if (event.key === "Escape") {
              event.preventDefault();
              cancel();
            }
          }}
        />
      </h1>
    );
  }

  return (
    <h1 className="trellis-document-title">
      <button
        type="button"
        className="trellis-document-title-hitbox w-full cursor-text rounded-sm text-left outline-none transition hover:bg-trellis-surface-2/35 focus-visible:ring-2 focus-visible:ring-trellis-accent/35"
        onClick={() => {
          setDraft(title);
          setEditing(true);
        }}
      >
        {title}
      </button>
    </h1>
  );
}
