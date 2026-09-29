import * as THREE from 'three';
import { type GLTF } from 'three/addons/loaders/GLTFLoader.js';
export interface LoadProgress {
    loaded: number;
    total: number | null;
    ratio: number | null;
}
export interface GLBLoaderOptions {
    dracoDecoderPath?: string;
    ktx2TranscoderPath?: string;
    manager?: THREE.LoadingManager;
}
export interface GLBLoadOptions {
    signal?: AbortSignal;
    onProgress?: (progress: LoadProgress) => void;
    
    resourcePath?: string;
    credentials?: RequestCredentials;
}
export type GLBSource = string | URL | Blob | ArrayBuffer;

export declare class GLBAsset {
    readonly gltf: GLTF;
    readonly scene: THREE.Group;
    readonly animations: THREE.AnimationClip[];
    readonly mixer: THREE.AnimationMixer;
    private actions;
    private disposed;
    private paused;
    constructor(gltf: GLTF);
    
    play(clip?: number | string): void;
    pause(): void;
    resume(): void;
    get isPaused(): boolean;
    update(deltaSeconds: number): void;
    dispose(): void;
}
export declare class GLBLoader {
    private loader;
    private draco;
    private ktx2;
    private disposed;
    constructor(renderer: THREE.WebGLRenderer, options?: GLBLoaderOptions);
    load(source: GLBSource, options?: GLBLoadOptions): Promise<GLBAsset>;
    dispose(): void;
}
