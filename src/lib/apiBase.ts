
let apiBaseUrl: string | null = null;

export const getApiBase = async (): Promise<string> => {
  if (apiBaseUrl !== null) return apiBaseUrl;
  if (window.electronAPI) {
    const port = await window.electronAPI.getBackendPort();
    apiBaseUrl = `http://localhost:${port}`;
  } else {
    apiBaseUrl = '';
  }
  return apiBaseUrl;
};
