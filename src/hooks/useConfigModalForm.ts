import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

interface UseConfigModalFormOptions<TForm> {
  createEmptyForm: () => TForm;
  resetDelayMs?: number;
  onAfterClear?: () => void;
}

export interface UseConfigModalFormReturn<TForm> {
  form: TForm;
  setForm: Dispatch<SetStateAction<TForm>>;
  editingId: string | null;
  setEditingId: Dispatch<SetStateAction<string | null>>;
  showModal: boolean;
  setShowModal: Dispatch<SetStateAction<boolean>>;
  statusMsg: string;
  setStatusMsg: Dispatch<SetStateAction<string>>;
  clearEditor: () => void;
  openNew: () => void;
  closeModal: () => void;
}

export function useConfigModalForm<TForm>(
  options: UseConfigModalFormOptions<TForm>
): UseConfigModalFormReturn<TForm> {
  const {
    createEmptyForm,
    resetDelayMs = 300,
    onAfterClear,
  } = options;

  const [form, setForm] = useState<TForm>(() => createEmptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  const clearEditor = useCallback(() => {
    setEditingId(null);
    setForm(createEmptyForm());
    setStatusMsg('');
    onAfterClear?.();
  }, [createEmptyForm, onAfterClear]);

  const openNew = useCallback(() => {
    clearEditor();
    setShowModal(true);
  }, [clearEditor]);

  const closeModal = useCallback(() => {
    setShowModal(false);
  }, []);

  useEffect(() => {
    if (!showModal) {
      const timer = setTimeout(() => {
        clearEditor();
      }, resetDelayMs);
      return () => clearTimeout(timer);
    }
  }, [showModal, clearEditor, resetDelayMs]);

  return {
    form,
    setForm,
    editingId,
    setEditingId,
    showModal,
    setShowModal,
    statusMsg,
    setStatusMsg,
    clearEditor,
    openNew,
    closeModal,
  };
}
