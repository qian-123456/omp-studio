export interface CameraLink {
	captureId: string;
	url: string;
	qrSvg: string;
	expiresAt: string;
}

export interface CameraPhoto {
	id: string;
	path: string;
	name: string;
	width: number;
	height: number;
	state: "received" | "attached" | "failed";
	error?: string;
}

export interface CameraSnapshot {
	captureId: string;
	state: "waiting" | "connected" | "expired" | "stopped";
	expiresAt: string;
	photos: CameraPhoto[];
}
