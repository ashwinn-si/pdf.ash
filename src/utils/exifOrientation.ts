/**
 * Reads a JPEG's EXIF orientation tag, if present. Phone cameras write the
 * sensor's raw pixels and record how to rotate/mirror them for display
 * instead of rotating the pixels themselves — pdf-lib embeds the raw bytes
 * as-is, so without reading this tag a portrait phone photo comes out
 * sideways in the PDF (#11).
 *
 * Returns 1 (no transform) when there's no EXIF/orientation data, which
 * covers the majority of JPEGs that didn't come straight off a camera.
 */
export function readJpegOrientation(bytes: Uint8Array): number {
  // JPEG is a sequence of 0xFFxx marker segments. EXIF lives in an APP1
  // (0xFFE1) segment starting with the ASCII "Exif\0\0" header, then a TIFF
  // header (which is where the orientation IFD entry lives).
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];

    // SOI/EOI and the restart markers (RSTn) carry no length field.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xda) break; // SOS — compressed scan data follows, no more markers to read

    const segmentLength = view.getUint16(offset + 2, false);

    if (marker === 0xe1) {
      const start = offset + 4;
      const hasExifHeader =
        start + 6 <= bytes.length &&
        bytes[start] === 0x45 && // E
        bytes[start + 1] === 0x78 && // x
        bytes[start + 2] === 0x69 && // i
        bytes[start + 3] === 0x66 && // f
        bytes[start + 4] === 0x00 &&
        bytes[start + 5] === 0x00;
      if (hasExifHeader) {
        const orientation = readOrientationFromTiff(view, start + 6);
        if (orientation !== null) return orientation;
      }
    }

    offset += 2 + segmentLength;
  }

  return 1;
}

/** Walks the 0th IFD of a TIFF header (little- or big-endian) for tag 0x0112
 * (Orientation), returning its SHORT value or null if absent/unparseable. */
function readOrientationFromTiff(view: DataView, tiffStart: number): number | null {
  if (tiffStart + 8 > view.byteLength) return null;

  const byteOrderMark = view.getUint16(tiffStart, false);
  const littleEndian = byteOrderMark === 0x4949; // "II" — Intel
  if (!littleEndian && byteOrderMark !== 0x4d4d) return null; // not "MM" (Motorola) either

  const ifdOffset = view.getUint32(tiffStart + 4, littleEndian);
  const ifdStart = tiffStart + ifdOffset;
  if (ifdStart < tiffStart || ifdStart + 2 > view.byteLength) return null;

  const entryCount = view.getUint16(ifdStart, littleEndian);
  for (let i = 0; i < entryCount; i++) {
    const entryOffset = ifdStart + 2 + i * 12;
    if (entryOffset + 12 > view.byteLength) break;
    const tag = view.getUint16(entryOffset, littleEndian);
    if (tag === 0x0112) {
      // Orientation is a SHORT (type 3); its value occupies the first 2
      // bytes of the entry's 4-byte value field regardless of byte order.
      return view.getUint16(entryOffset + 8, littleEndian);
    }
  }
  return null;
}
