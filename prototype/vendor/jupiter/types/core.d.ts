
export declare const VERSION = "1.0.0";
export declare const LOGICAL_VIEWS = 30;
export type ViewOrder = 'forward' | 'reverse' | 'pingpong';
export interface Calibration {
    
    pitch: number;
    
    tan: number;
    offset: number;
    order: ViewOrder;
    subpixelOrder: 'RGB' | 'BGR';
    rotation: 0 | 90 | 180 | 270;
}
export interface RenderOptions {
    views: number;
    viewWidth: number;
    viewSpacing: number;
    focusDistance: number;
    mode: 'interlaced' | '2d' | 'view';
    previewView: number;
    toneMapping: 'none' | 'reinhard' | 'aces';
    exposure: number;
}
export interface Profile {
    schemaVersion: 1;
    algorithm: 'jupiter-30-v1';
    calibration: Calibration;
    render: RenderOptions;
}
export declare const DEFAULT_CALIBRATION: Readonly<Calibration>;
export declare const DEFAULT_RENDER_OPTIONS: Readonly<RenderOptions>;
export declare function validateCalibration(value: Calibration): Calibration;
export declare function validateRenderOptions(value: RenderOptions): RenderOptions;
export declare function logicalView(raw: number, c: Calibration): number;

export declare function subpixelViews(x: number, y: number, width: number, height: number, c: Calibration): [number, number, number];
export declare function renderedView(logicalIndex: number, count: number): number;

export declare function viewLogicalIndex(index: number, count: number): number;
export declare function createProfile(calibration?: Partial<Calibration>, render?: Partial<RenderOptions>): Profile;

export declare function parseProfile(input: string | object): Profile;
