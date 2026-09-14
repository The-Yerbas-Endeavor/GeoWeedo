'use client';

import type { ScannerFocusPoint } from './useScannerCameraAssist';

type Props = {
  torchAvailable: boolean;
  torchOn: boolean;
  toggleTorch: () => Promise<void> | void;
  zoomAvailable: boolean;
  zoom: number;
  zoomMin: number;
  zoomMax: number;
  zoomStep: number;
  setZoom: (value: number) => Promise<void> | void;
  focusAvailable: boolean;
};

export function ScannerFocusIndicator({ point }: { point: ScannerFocusPoint }) {
  if (!point) return null;
  return (
    <span
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: `${point.x}%`,
        top: `${point.y}%`,
        width: 46,
        height: 46,
        transform: 'translate(-50%, -50%)',
        border: '2px solid rgba(214,255,188,.98)',
        borderRadius: 10,
        boxShadow: '0 0 0 1px rgba(0,0,0,.55), 0 0 18px rgba(126,217,87,.55)',
        pointerEvents: 'none',
        zIndex: 7,
      }}
    />
  );
}

export default function ScannerCameraAssistControls(props: Props) {
  const hasControls = props.torchAvailable || props.zoomAvailable || props.focusAvailable;
  if (!hasControls) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        flexWrap: 'wrap',
        padding: '0 14px 12px',
        color: 'rgba(236,246,238,.9)',
        fontSize: 12,
      }}
    >
      {props.torchAvailable ? (
        <button
          type="button"
          onClick={() => void props.toggleTorch()}
          aria-pressed={props.torchOn}
          style={{
            minHeight: 36,
            padding: '8px 11px',
            border: '1px solid rgba(255,255,255,.16)',
            borderRadius: 10,
            background: props.torchOn ? 'rgba(126,217,87,.18)' : 'rgba(255,255,255,.06)',
            color: '#f2f8f2',
            fontWeight: 800,
            cursor: 'pointer',
          }}
        >
          {props.torchOn ? '🔦 Light on' : '🔦 Light'}
        </button>
      ) : null}

      {props.zoomAvailable ? (
        <label style={{display:'flex',alignItems:'center',gap:7,minHeight:36,padding:'6px 9px',border:'1px solid rgba(255,255,255,.12)',borderRadius:10,background:'rgba(255,255,255,.04)'}}>
          <span style={{fontWeight:800}}>Zoom</span>
          <input
            aria-label="Camera zoom"
            type="range"
            min={props.zoomMin}
            max={props.zoomMax}
            step={props.zoomStep}
            value={props.zoom}
            onChange={(event) => void props.setZoom(Number(event.target.value))}
            style={{width:'clamp(92px,28vw,150px)'}}
          />
          <span style={{minWidth:34,textAlign:'right',fontVariantNumeric:'tabular-nums'}}>{props.zoom.toFixed(1)}×</span>
        </label>
      ) : null}

      {props.focusAvailable ? (
        <span style={{opacity:.72,fontWeight:700}}>Tap preview to refocus</span>
      ) : null}
    </div>
  );
}
