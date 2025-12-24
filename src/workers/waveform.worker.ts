/// <reference lib="webworker" />

/* eslint-disable no-restricted-globals */

const ctx: DedicatedWorkerGlobalScope = self as any;

interface SetAudioPayload {
  data: Float32Array;
}

interface ComputePayload {
  id: number;
  width: number;
  samplesPerPixel: number;
}

let audioData: Float32Array | null = null;

ctx.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data;

  if (type === 'SET_AUDIO') {
    audioData = payload.data;
  } else if (type === 'COMPUTE') {
    if (!audioData) {
        ctx.postMessage({
            id: payload.id,
            mins: new Float32Array(0),
            maxs: new Float32Array(0),
        });
        return;
    }

    const { id, width, samplesPerPixel } = payload;

    if (width <= 0) {
       ctx.postMessage({ id, mins: new Float32Array(0), maxs: new Float32Array(0) });
       return;
    }

    const mins = new Float32Array(width);
    const maxs = new Float32Array(width);

    for (let i = 0; i < width; i++) {
        let min = 1.0;
        let max = -1.0;

        const startIndex = Math.floor(i * samplesPerPixel);
        const endIndex = Math.floor((i + 1) * samplesPerPixel);
        const loopEnd = Math.max(startIndex + 1, endIndex);

        if (startIndex >= audioData.length) {
            min = 0;
            max = 0;
        } else {
             for (let j = startIndex; j < loopEnd; j++) {
                if (j >= audioData.length) break;
                const datum = audioData[j];
                if (datum < min) min = datum;
                if (datum > max) max = datum;
            }

            if (min > max) {
                min = 0;
                max = 0;
            }
        }

        mins[i] = min;
        maxs[i] = max;
    }

    ctx.postMessage({ id, mins, maxs }, [mins.buffer, maxs.buffer]);
  }
};
