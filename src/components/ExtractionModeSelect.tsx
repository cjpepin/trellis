import type { ExtractionMode } from "@electron/ipc/types";
import { ListboxSelect } from "@/components/ListboxSelect";

export interface ExtractionModeOption {
  id: ExtractionMode;
  label: string;
}

interface Props {
  id: string;
  options: ExtractionModeOption[];
  value: ExtractionMode;
  onSelect: (mode: ExtractionMode) => void;
  disabled?: boolean;
  className?: string;
}

export function ExtractionModeSelect({
  id,
  options,
  value,
  onSelect,
  disabled = false,
  className
}: Props) {
  return (
    <ListboxSelect
      id={id}
      options={options}
      value={value}
      onSelect={onSelect}
      listboxAriaLabel="Notes from chats processing mode"
      disabled={disabled}
      className={className}
    />
  );
}
