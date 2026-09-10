
export interface SaveHandlerContext {
  editingId: string | null;
}

export interface ModuleSaveHandlersDeps<TForm> {
  handleSave: (data: Partial<TForm>, editingId: string | null) => Promise<{ id?: string }>;
  handleStart: (id: string) => Promise<boolean>;
  closeModal: () => void;
  fetchConfigs: () => void | Promise<void>;
  buildConfigData: (form: TForm, ctx: SaveHandlerContext) => Partial<TForm>;
  isRunMode?: () => boolean;
  handleRunMode?: (configData: Partial<TForm>, ctx: SaveHandlerContext) => Promise<void> | void;
}

export interface ModuleSaveHandlers<TForm> {
  handleSaveConfig: (form: TForm, editingId: string | null) => Promise<void>;
  handleSaveAndStart: (form: TForm, editingId: string | null) => Promise<void>;
}

export function createModuleSaveHandlers<TForm>(
  deps: ModuleSaveHandlersDeps<TForm>
): ModuleSaveHandlers<TForm> {
  const handleSaveConfig: ModuleSaveHandlers<TForm>['handleSaveConfig'] = async (form, editingId) => {
    const configData = deps.buildConfigData(form, { editingId });
    if (deps.isRunMode?.() && deps.handleRunMode) {
      await deps.handleRunMode(configData, { editingId });
      return;
    }
    deps.handleSave(configData, editingId);
    deps.closeModal();
  };

  const handleSaveAndStart: ModuleSaveHandlers<TForm>['handleSaveAndStart'] = async (form, editingId) => {
    const configData = deps.buildConfigData(form, { editingId });
    const result = await deps.handleSave(configData, editingId);
    deps.closeModal();
    if (result.id) {
      await deps.handleStart(result.id);
      await deps.fetchConfigs();
    }
  };

  return { handleSaveConfig, handleSaveAndStart };
}

export const createModule = createModuleSaveHandlers;
