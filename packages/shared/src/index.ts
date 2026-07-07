export type ThemeMode = 'dark' | 'light' | 'system';

export interface AppSettings {
  language: 'ru' | 'en';
  theme: ThemeMode;
  accent: 'teal';
  uiScale: number;
  clipboardPasswordSeconds: number;
  clipboardUsernameSeconds: number;
  autoLockMinutes: number;
  closeBehavior: 'quit' | 'tray';
  restoreTabs: boolean;
  recoveryEnabled: boolean;
  recentDatabases: string[];
  lastOpenDatabases: string[];
  windowBounds?: {
    x?: number;
    y?: number;
    width: number;
    height: number;
  };
}

export const DEFAULT_AUTO_TYPE_SEQUENCE = '{USERNAME}{TAB}{PASSWORD}{ENTER}';

export interface CustomFieldSummary {
  key: string;
  value: string;
  protected: boolean;
  hasValue: boolean;
}

export interface CustomFieldInput {
  key: string;
  value?: string;
  protected: boolean;
  preserveValue?: boolean;
  originalKey?: string;
}

export interface AttachmentSummary {
  name: string;
  size: number;
}

export interface EntrySummary {
  id: string;
  groupId: string;
  title: string;
  username: string;
  url: string;
  notes: string;
  tags: string[];
  favorite: boolean;
  expires: boolean;
  expiryTime?: string;
  modifiedAt?: string;
  customFields: CustomFieldSummary[];
  attachments: AttachmentSummary[];
}

export interface GroupSummary {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  entryCount: number;
}

export interface DatabaseView {
  sessionId: string;
  path: string;
  name: string;
  locked: boolean;
  readOnly: boolean;
  dirty: boolean;
  groups: GroupSummary[];
  entries: EntrySummary[];
  selectedGroupId: string | null;
}

export interface OpenDatabaseRequest {
  path: string;
  password: string;
  forceReadWrite?: boolean;
}

export interface CreateDatabaseRequest {
  path: string;
  password: string;
  name: string;
}

export interface SaveEntryRequest {
  sessionId: string;
  entryId?: string;
  groupId: string;
  title: string;
  username: string;
  password?: string;
  url: string;
  notes: string;
  tags: string[];
  favorite: boolean;
  expires: boolean;
  expiryTime?: string;
  customFields?: CustomFieldInput[];
}

export interface CreateGroupRequest {
  sessionId: string;
  parentId: string | null;
  name: string;
}

export interface MoveEntryRequest {
  sessionId: string;
  entryId: string;
  targetGroupId: string;
  beforeEntryId?: string | null;
}

export interface MoveGroupRequest {
  sessionId: string;
  groupId: string;
  targetGroupId: string;
}

export interface CopySecretRequest {
  value: string;
  kind: 'password' | 'username' | 'url' | 'custom';
}

export interface AutoTypeSelection {
  sessionId: string | null;
  entryId: string | null;
}

export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: string;
  };
}

export interface PassDeckApi {
  settings: {
    get(): Promise<AppSettings>;
    update(patch: Partial<AppSettings>): Promise<AppSettings>;
  };
  dialog: {
    chooseOpenFiles(): Promise<string[]>;
    chooseCreateFile(defaultName: string): Promise<string | null>;
  };
  database: {
    open(request: OpenDatabaseRequest): Promise<ApiResult<DatabaseView>>;
    create(request: CreateDatabaseRequest): Promise<ApiResult<DatabaseView>>;
    list(): Promise<DatabaseView[]>;
    get(sessionId: string): Promise<ApiResult<DatabaseView>>;
    save(sessionId: string): Promise<ApiResult<DatabaseView>>;
    saveEntry(request: SaveEntryRequest): Promise<ApiResult<DatabaseView>>;
    deleteEntry(sessionId: string, entryId: string): Promise<ApiResult<DatabaseView>>;
    createGroup(request: CreateGroupRequest): Promise<ApiResult<DatabaseView>>;
    deleteGroup(sessionId: string, groupId: string): Promise<ApiResult<DatabaseView>>;
    moveEntry(request: MoveEntryRequest): Promise<ApiResult<DatabaseView>>;
    moveGroup(request: MoveGroupRequest): Promise<ApiResult<DatabaseView>>;
    lock(sessionId: string): Promise<ApiResult<DatabaseView>>;
    unlock(sessionId: string, password: string): Promise<ApiResult<DatabaseView>>;
    close(sessionId: string): Promise<ApiResult<null>>;
    forceReadWrite(sessionId: string): Promise<ApiResult<DatabaseView>>;
    revealPassword(sessionId: string, entryId: string): Promise<ApiResult<string>>;
    revealCustomField(sessionId: string, entryId: string, key: string): Promise<ApiResult<string>>;
    addAttachments(sessionId: string, entryId: string): Promise<ApiResult<DatabaseView>>;
    exportAttachment(sessionId: string, entryId: string, name: string): Promise<ApiResult<boolean>>;
    deleteAttachment(
      sessionId: string,
      entryId: string,
      name: string,
    ): Promise<ApiResult<DatabaseView>>;
  };
  autoType: {
    setSelection(selection: AutoTypeSelection): Promise<ApiResult<null>>;
    onError(listener: (message: string) => void): () => void;
  };
  clipboard: {
    copy(request: CopySecretRequest): Promise<ApiResult<null>>;
  };
  app: {
    quit(): Promise<ApiResult<null>>;
    lockAll(): Promise<ApiResult<null>>;
  };
}
