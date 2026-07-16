/// <reference types="vite/client" />
/// <reference types="react" />
/// <reference types="react-dom" />

interface ImportMetaEnv {
  // Define custom environment variables here
  readonly VITE_APP_TITLE: string;
  readonly VITE_ROSBRIDGE_PORT?: string;
  readonly VITE_VIDEO_STREAM_PORT?: string;
  readonly VITE_MESH_RESOURCES_PORT?: string;
  // more env variables...
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
