// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, expect, it } from 'vitest';
import type { BlueprintSourceRef } from '@/types/blueprint';
import {
  splitSceneIdToString,
  sourceRefToSplitSceneId,
  makeLegacyDirectorSourceRef,
  isDirectorSceneSourceRef,
  isLegacySourceRef,
  migrateDirectorSourceRefToShot,
} from '../legacy-id-mapper';

describe('legacy-id-mapper', () => {
  describe('splitSceneIdToString', () => {
    it('converts numeric ID to string', () => {
      expect(splitSceneIdToString(42)).toBe('42');
    });

    it('converts zero to "0"', () => {
      expect(splitSceneIdToString(0)).toBe('0');
    });

    it('converts negative numbers', () => {
      expect(splitSceneIdToString(-1)).toBe('-1');
    });

    it('converts large numbers', () => {
      expect(splitSceneIdToString(999999999)).toBe('999999999');
    });
  });

  describe('sourceRefToSplitSceneId', () => {
    it('parses director-scene sourceRef ID back to number', () => {
      const ref: BlueprintSourceRef = {
        kind: 'director-scene',
        id: '42',
      };
      expect(sourceRefToSplitSceneId(ref)).toBe(42);
    });

    it('returns NaN for non-director-scene kind', () => {
      const ref: BlueprintSourceRef = {
        kind: 'shot',
        id: '42',
      };
      expect(sourceRefToSplitSceneId(ref)).toBeNaN();
    });

    it('returns NaN for UUID-based IDs (not numeric)', () => {
      const ref: BlueprintSourceRef = {
        kind: 'director-scene',
        id: 'abc-def-123',
      };
      expect(sourceRefToSplitSceneId(ref)).toBeNaN();
    });
  });

  describe('makeLegacyDirectorSourceRef', () => {
    it('creates a director-scene sourceRef with numeric ID as string', () => {
      const ref = makeLegacyDirectorSourceRef(5);
      expect(ref).toEqual({
        kind: 'director-scene',
        id: '5',
        sourceVersion: undefined,
      });
    });

    it('includes sourceVersion when provided', () => {
      const ref = makeLegacyDirectorSourceRef(5, 'v1.0');
      expect(ref.sourceVersion).toBe('v1.0');
    });
  });

  describe('isDirectorSceneSourceRef', () => {
    it('returns true for director-scene kind', () => {
      const ref: BlueprintSourceRef = {
        kind: 'director-scene',
        id: '1',
      };
      expect(isDirectorSceneSourceRef(ref)).toBe(true);
    });

    it('returns false for shot kind', () => {
      const ref: BlueprintSourceRef = {
        kind: 'shot',
        id: '1',
      };
      expect(isDirectorSceneSourceRef(ref)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isDirectorSceneSourceRef(undefined)).toBe(false);
    });
  });

  describe('isLegacySourceRef', () => {
    it('returns true for director-scene kind', () => {
      const ref: BlueprintSourceRef = {
        kind: 'director-scene',
        id: '1',
      };
      expect(isLegacySourceRef(ref)).toBe(true);
    });

    it('returns false for shot kind', () => {
      const ref: BlueprintSourceRef = {
        kind: 'shot',
        id: '1',
      };
      expect(isLegacySourceRef(ref)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isLegacySourceRef(undefined)).toBe(false);
    });
  });

  describe('migrateDirectorSourceRefToShot', () => {
    it('converts director-scene to shot kind', () => {
      const ref: BlueprintSourceRef = {
        kind: 'director-scene',
        id: '42',
      };
      const migrated = migrateDirectorSourceRefToShot(ref);
      expect(migrated).toEqual({
        kind: 'shot',
        id: '42',
      });
    });

    it('uses provided shotId when available', () => {
      const ref: BlueprintSourceRef = {
        kind: 'director-scene',
        id: '42',
      };
      const migrated = migrateDirectorSourceRefToShot(ref, 'shot-abc');
      expect(migrated).toEqual({
        kind: 'shot',
        id: 'shot-abc',
      });
    });

    it('returns null for non-director-scene kind', () => {
      const ref: BlueprintSourceRef = {
        kind: 'shot',
        id: '42',
      };
      expect(migrateDirectorSourceRefToShot(ref)).toBeNull();
    });

    it('returns null for media kind', () => {
      const ref: BlueprintSourceRef = {
        kind: 'media',
        id: '42',
      };
      expect(migrateDirectorSourceRefToShot(ref)).toBeNull();
    });
  });

  describe('round-trip: splitSceneIdToString → sourceRefToSplitSceneId', () => {
    it('preserves value through round-trip', () => {
      const originalId = 12345;
      const stringId = splitSceneIdToString(originalId);
      const ref = makeLegacyDirectorSourceRef(originalId);
      const parsedBack = sourceRefToSplitSceneId(ref);
      expect(parsedBack).toBe(originalId);
    });
  });
});
