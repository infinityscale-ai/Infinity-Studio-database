import { useCallback } from "react";

// Returns a stable callback that toggles a row index in the selected-rows set.
export function useToggleRowSelection(
  setSelectedRows: React.Dispatch<React.SetStateAction<Set<number>>>,
) {
  return useCallback((index: number) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, [setSelectedRows]);
}

export function useToggleHandlers(
  setter: (v: boolean) => void,
): [() => void, () => void] {
  const handleOpen = useCallback(() => setter(true), [setter]);
  const handleClose = useCallback(() => setter(false), [setter]);
  return [handleOpen, handleClose];
}
