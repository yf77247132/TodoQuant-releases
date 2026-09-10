import { useQuery } from '@tanstack/react-query';
import type { BaseConfigItem } from './useConfigManager.ts';

export function useConfigList<T extends BaseConfigItem>(
  moduleName: string,
  apiPrefix: string,
) {
  const { data: configs = [], isLoading } = useQuery<T[]>({
    queryKey: [moduleName, 'configs'],
    queryFn: async () => {
      const res = await fetch(`${apiPrefix}/configs`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      return data.data;
    },
    staleTime: 60000,
    refetchOnWindowFocus: true,
  });

  return { configs, isLoading };
}
