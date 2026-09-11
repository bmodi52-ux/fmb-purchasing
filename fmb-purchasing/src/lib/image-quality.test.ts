import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { BLURRY_BELOW, sharpnessScore } from "./image-quality.ts";

/** A page of "print": dark 2-pixel strokes on white, in one corner of an otherwise blank photo. */
function printed(width: number, height: number): Uint8ClampedArray {
  const gray = new Uint8ClampedArray(width * height).fill(235);
  for (let y = 20; y < height / 3; y++) {
    for (let x = 20; x < width / 3; x++) {
      if (x % 6 < 2 || y % 9 < 2) gray[y * width + x] = 30;
    }
  }
  return gray;
}

/** A box blur of the given radius, run twice — roughly what a shaky hand does. */
function blurred(gray: Uint8ClampedArray, width: number, height: number, radius: number): Uint8ClampedArray {
  let src = gray;
  for (let pass = 0; pass < 2; pass++) {
    const out = new Uint8ClampedArray(src.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let n = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const yy = y + dy;
            const xx = x + dx;
            if (yy >= 0 && yy < height && xx >= 0 && xx < width) {
              sum += src[yy * width + xx];
              n++;
            }
          }
        }
        out[y * width + x] = sum / n;
      }
    }
    src = out;
  }
  return src;
}

describe("sharpnessScore", () => {
  const width = 240;
  const height = 320;
  const sharp = printed(width, height);

  test("sharp print scores well above the line, even on mostly blank paper", () => {
    assert.ok(sharpnessScore(sharp, width, height) > BLURRY_BELOW * 5);
  });

  test("the same print out of focus falls below it", () => {
    assert.ok(sharpnessScore(blurred(sharp, width, height, 4), width, height) < BLURRY_BELOW);
  });

  test("a blank photo has nothing sharp in it", () => {
    assert.equal(sharpnessScore(new Uint8ClampedArray(width * height).fill(200), width, height), 0);
  });
});
