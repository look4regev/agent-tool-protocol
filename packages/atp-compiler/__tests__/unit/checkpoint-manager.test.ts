import { CheckpointManager } from '../../src/runtime/checkpoint-manager';
import type { CacheProvider } from '@agent-tool-protocol/protocol';
import type { LoopCheckpoint } from '../../src/types';

describe('CheckpointManager', () => {
	let mockCache: jest.Mocked<CacheProvider>;
	let manager: CheckpointManager;

	beforeEach(() => {
		mockCache = {
			get: jest.fn(),
			set: jest.fn(),
			delete: jest.fn(),
		} as any;

		manager = new CheckpointManager('exec-123', mockCache, 'test-checkpoint');
	});

	describe('save', () => {
		it('should save checkpoint to cache', async () => {
			const checkpoint: LoopCheckpoint = {
				loopId: 'loop-1',
				currentIndex: 5,
				timestamp: Date.now(),
			};

			await manager.save(checkpoint);

			expect(mockCache.set).toHaveBeenCalledWith(
				'test-checkpoint:exec-123:loop-1',
				checkpoint,
				3600
			);
		});

		it('should save checkpoint with results', async () => {
			const checkpoint: LoopCheckpoint = {
				loopId: 'loop-1',
				currentIndex: 3,
				results: ['a', 'b', 'c'],
				timestamp: Date.now(),
			};

			await manager.save(checkpoint);

			expect(mockCache.set).toHaveBeenCalledWith(
				'test-checkpoint:exec-123:loop-1',
				checkpoint,
				3600
			);
		});

		it('should throw CheckpointError if size exceeds limit', async () => {
			const largeArray = Array(100000).fill('x'.repeat(1000));
			const checkpoint: LoopCheckpoint = {
				loopId: 'loop-1',
				currentIndex: 1,
				results: largeArray,
				timestamp: Date.now(),
			};

			await expect(manager.save(checkpoint)).rejects.toThrow('Checkpoint size');
		});

		it('should throw CheckpointError on cache failure', async () => {
			mockCache.set.mockRejectedValue(new Error('Cache error'));

			const checkpoint: LoopCheckpoint = {
				loopId: 'loop-1',
				currentIndex: 1,
				timestamp: Date.now(),
			};

			await expect(manager.save(checkpoint)).rejects.toThrow('Checkpoint save failed');
		});
	});

	describe('load', () => {
		it('should load checkpoint from cache', async () => {
			const checkpoint: LoopCheckpoint = {
				loopId: 'loop-1',
				currentIndex: 5,
				timestamp: Date.now(),
			};

			mockCache.get.mockResolvedValue(checkpoint);

			const result = await manager.load('loop-1');

			expect(result).toEqual(checkpoint);
			expect(mockCache.get).toHaveBeenCalledWith('test-checkpoint:exec-123:loop-1');
		});

		it('should return null if checkpoint not found', async () => {
			mockCache.get.mockResolvedValue(null);

			const result = await manager.load('loop-1');

			expect(result).toBeNull();
		});

		it('should convert completed array to Set', async () => {
			const checkpoint = {
				loopId: 'loop-1',
				currentIndex: 5,
				completed: [0, 1, 2],
				timestamp: Date.now(),
			};

			mockCache.get.mockResolvedValue(checkpoint);

			const result = await manager.load('loop-1');

			expect(result).not.toBeNull();
			expect(result!.completed).toBeInstanceOf(Set);
			expect(result!.completed).toEqual(new Set([0, 1, 2]));
		});

		it('should throw CheckpointError on cache failure', async () => {
			mockCache.get.mockRejectedValue(new Error('Cache error'));

			await expect(manager.load('loop-1')).rejects.toThrow('Checkpoint load failed');
		});
	});

	describe('clear', () => {
		it('should clear checkpoint from cache', async () => {
			await manager.clear('loop-1');

			expect(mockCache.delete).toHaveBeenCalledWith('test-checkpoint:exec-123:loop-1');
		});

		it('should throw CheckpointError on cache failure', async () => {
			mockCache.delete.mockRejectedValue(new Error('Cache error'));

			await expect(manager.clear('loop-1')).rejects.toThrow('Checkpoint clear failed');
		});
	});

	describe('getExecutionId', () => {
		it('should return execution ID', () => {
			expect(manager.getExecutionId()).toBe('exec-123');
		});
	});
});
