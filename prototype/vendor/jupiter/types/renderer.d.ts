import * as THREE from 'three';
import { type Calibration, type RenderOptions, type Profile } from './core.js';
export interface ViewInfo {
    index: number;
    logicalIndex: number;
    offset: number;
    count: number;
    width: number;
    height: number;
}
export interface FrameStats {
    frames: number;
    views: number;
    width: number;
    height: number;
    viewWidth: number;
    viewHeight: number;
    cpuMs: number;
    estimatedBufferBytes: number;
}
export interface AtlasInput {
    texture: THREE.Texture;
    
    width: number;
    height: number;
    columns: number;
    rows: number;
    views: number;
    
    encoding?: 'srgb' | 'linear';
}

export declare class InterlaceRenderer {
    readonly renderer: THREE.WebGLRenderer;
    private profile;
    private eye;
    private eyeTarget;
    private front;
    private back;
    private quadCamera;
    private quadScene;
    private geometry;
    private uniforms;
    private material;
    private copyMaterial;
    private quad;
    private busy;
    private disposed;
    private listeners;
    private stats;
    constructor(renderer: THREE.WebGLRenderer, options?: {
        calibration?: Partial<Calibration>;
        render?: Partial<RenderOptions>;
    });
    getProfile(): Profile;
    exportProfile(): string;
    importProfile(input: string | object): void;
    setCalibration(patch: Partial<Calibration>): void;
    setOptions(patch: Partial<RenderOptions>): void;
    subscribe(listener: (profile: Profile) => void): () => void;
    private notify;
    getStats(): FrameStats;
    
    get outputTexture(): THREE.Texture;
    private assertAlive;
    private withState;
    private bindTarget;
    private prepare;
    private drawComposite;
    private publish;
    
    render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void;
    
    renderViews(draw: (target: THREE.WebGLRenderTarget, view: ViewInfo) => void): void;
    
    compositeAtlas(input: AtlasInput): void;
    dispose(): void;
}
