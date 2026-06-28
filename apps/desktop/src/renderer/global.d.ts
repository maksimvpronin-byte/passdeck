import type { ApiResult, DatabaseView, PassDeckApi } from '@passdeck/shared';

type TouchIdStatus = {
  available: boolean;
  enabled: boolean;
  reason?: string;
};

type PassDeckTouchIdApi = {
  touchId: {
    status(filePath?: string): Promise<ApiResult<TouchIdStatus>>;
    storePassword(filePath: string, password: string): Promise<ApiResult<null>>;
    forget(filePath: string): Promise<ApiResult<null>>;
    open(filePath: string): Promise<ApiResult<DatabaseView>>;
    unlock(sessionId: string): Promise<ApiResult<DatabaseView>>;
  };
};

declare global {
  interface Window {
    passdeck: PassDeckApi & PassDeckTouchIdApi;
  }
}

export {};
