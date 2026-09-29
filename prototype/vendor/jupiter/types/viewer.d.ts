import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { InterlaceRenderer } from './renderer.js';
import { GLBAsset, GLBLoader, type GLBSource, type GLBLoadOptions, type GLBLoaderOptions } from './glb.js';
import type { Calibration, RenderOptions } from './core.js';
export interface ViewerOptions {
    container: HTMLElement;
    calibration?: Partial<Calibration>;
    render?: Partial<RenderOptions>;
    decoders?: GLBLoaderOptions;
    
    defaultLights?: boolean;
    autoStart?: boolean;
    onError?: (error: Error) => void;
}
export interface ViewerLoadOptions extends GLBLoadOptions {
    autoFrame?: boolean;
    autoPlay?: boolean;
    
    onLoad?: (asset: GLBAsset) => void;
    onError?: (error: Error) => void;
}

export declare class JupiterViewer {
    readonly renderer: THREE.WebGLRenderer;
    readonly scene: THREE.Scene;
    readonly camera: THREE.PerspectiveCamera;
    readonly controls: OrbitControls;
    readonly interlacer: InterlaceRenderer;
    readonly loader: GLBLoader;
    readonly container: HTMLElement;
    private root;
    private asset;
    private observer;
    private abort;
    private loadSequence;
    private raf;
    private running;
    private disposed;
    private lastTime;
    private lastDpr;
    private cssWidth;
    private cssHeight;
    private frameListeners;
    private onError?;
    constructor(options: ViewerOptions);
    get model(): GLBAsset | null;
    private contextLost;
    private contextRestored;
    
    resize(): void;
    setCalibration(patch: Partial<Calibration>): void;
    setOptions(patch: Partial<RenderOptions>): void;
    exportProfile(): string;
    importProfile(profile: string | object): void;
    onFrame(callback: (deltaSeconds: number) => void): () => void;
    loadGLB(source: GLBSource, options?: ViewerLoadOptions): Promise<GLBAsset>;
    
    frameModel(): void;
    unload(): void;
    render(deltaSeconds?: number): void;
    private tick;
    start(): void;
    stop(): void;
    dispose(): void;
}
