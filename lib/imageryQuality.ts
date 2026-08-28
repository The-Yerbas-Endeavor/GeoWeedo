export type ImageryQualityPhoto = {
  id?: string;
  projection?: string;
  fieldOfView?: number;
  width?: number;
  height?: number;
  status?: string;
  qualityLevel?: number;
  sequenceId?: string;
};

export type ImageryQualityResult = {
  playable: boolean;
  grade: 'A' | 'B' | 'F';
  mode: '360' | 'sequence' | 'unusable';
  reason: string;
  frameCount: number;
  landscapeFrames: number;
  landscapeRatio: number;
};

const isSphere = (photo: ImageryQualityPhoto) => {
  const projection = String(photo.projection || '').toUpperCase();
  return projection === 'SPHERE' || projection === 'EQUIRECTANGULAR' || Number(photo.fieldOfView || 0) >= 300;
};

const isActive = (photo: ImageryQualityPhoto) => {
  const status = String(photo.status || '').toLowerCase();
  return !status || status === 'active' || status === 'public';
};

const isLandscape = (photo: ImageryQualityPhoto) => {
  const width = Number(photo.width || 0);
  const height = Number(photo.height || 0);
  if (!width || !height) return false;
  return width / height >= 1.2;
};

export function gradeImagery(selected: ImageryQualityPhoto | undefined, sequence: ImageryQualityPhoto[] = []): ImageryQualityResult {
  if (!selected) return { playable: false, grade: 'F', mode: 'unusable', reason: 'No imagery selected.', frameCount: 0, landscapeFrames: 0, landscapeRatio: 0 };

  if (isSphere(selected) && isActive(selected)) {
    return { playable: true, grade: 'A', mode: '360', reason: 'True 360° / equirectangular imagery.', frameCount: Math.max(1, sequence.length), landscapeFrames: 0, landscapeRatio: 1 };
  }

  const sameSequence = sequence.filter((photo) => !selected.sequenceId || !photo.sequenceId || photo.sequenceId === selected.sequenceId).filter(isActive);
  const frameCount = sameSequence.length;
  const dimensioned = sameSequence.filter((photo) => Number(photo.width || 0) > 0 && Number(photo.height || 0) > 0);
  const landscapeFrames = dimensioned.filter(isLandscape).length;
  const landscapeRatio = dimensioned.length ? landscapeFrames / dimensioned.length : 0;
  const selectedLandscape = isLandscape(selected);
  const selectedWidth = Number(selected.width || 0);

  if (frameCount < 8) {
    return { playable: false, grade: 'F', mode: 'unusable', reason: `Only ${frameCount} usable frame(s); at least 8 are required for street movement.`, frameCount, landscapeFrames, landscapeRatio };
  }
  if (!selectedLandscape) {
    return { playable: false, grade: 'F', mode: 'unusable', reason: 'Selected KartaView frame is portrait or lacks verifiable landscape dimensions.', frameCount, landscapeFrames, landscapeRatio };
  }
  if (selectedWidth < 1280) {
    return { playable: false, grade: 'F', mode: 'unusable', reason: `Selected frame is only ${selectedWidth || 'unknown'}px wide; at least 1280px is required.`, frameCount, landscapeFrames, landscapeRatio };
  }
  if (dimensioned.length < Math.min(6, frameCount)) {
    return { playable: false, grade: 'F', mode: 'unusable', reason: 'Not enough frames expose dimensions to verify sequence orientation.', frameCount, landscapeFrames, landscapeRatio };
  }
  if (landscapeRatio < 0.7) {
    return { playable: false, grade: 'F', mode: 'unusable', reason: `Only ${Math.round(landscapeRatio * 100)}% of verifiable frames are landscape; 70% is required.`, frameCount, landscapeFrames, landscapeRatio };
  }

  return { playable: true, grade: 'B', mode: 'sequence', reason: `${frameCount} usable frames with ${Math.round(landscapeRatio * 100)}% landscape coverage.`, frameCount, landscapeFrames, landscapeRatio };
}
