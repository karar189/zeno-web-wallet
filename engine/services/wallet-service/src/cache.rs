use std::collections::BTreeMap;
use std::fmt;
use std::sync::Mutex;

#[derive(Debug)]
pub struct CacheError(String);

impl fmt::Display for CacheError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for CacheError {}

impl From<String> for CacheError {
    fn from(value: String) -> Self {
        Self(value)
    }
}

use async_trait::async_trait;
use zcash_client_backend::data_api::chain::error::Error as ChainError;
use zcash_client_backend::data_api::chain::{BlockCache, BlockSource};
use zcash_client_backend::data_api::scanning::ScanRange;
use zcash_client_backend::proto::compact_formats::CompactBlock;
use zcash_protocol::consensus::BlockHeight;

#[derive(Default)]
pub struct MemoryBlockCache {
    blocks: Mutex<BTreeMap<u32, CompactBlock>>,
}

impl MemoryBlockCache {
    pub fn clear(&self) {
        if let Ok(mut blocks) = self.blocks.lock() {
            blocks.clear();
        }
    }

    fn height_of(block: &CompactBlock) -> BlockHeight {
        BlockHeight::from_u32(block.height as u32)
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, BTreeMap<u32, CompactBlock>>, CacheError> {
        self.blocks.lock().map_err(|error| CacheError(error.to_string()))
    }
}

impl BlockSource for MemoryBlockCache {
    type Error = CacheError;

    fn with_blocks<F, WalletErrT>(
        &self,
        from_height: Option<BlockHeight>,
        limit: Option<usize>,
        mut with_block: F,
    ) -> Result<(), ChainError<WalletErrT, Self::Error>>
    where
        F: FnMut(CompactBlock) -> Result<(), ChainError<WalletErrT, Self::Error>>,
    {
        let blocks = self.lock().map_err(ChainError::BlockSource)?;
        let start = from_height.map_or(0, u32::from);
        let mut emitted = 0usize;
        let mut expected = start;
        for (height, block) in blocks.range(start..) {
            if *height != expected {
                break;
            }
            if limit.is_some_and(|limit| emitted >= limit) {
                break;
            }
            with_block(block.clone())?;
            emitted += 1;
            expected = expected.saturating_add(1);
        }
        Ok(())
    }
}

#[async_trait]
impl BlockCache for MemoryBlockCache {
    fn get_tip_height(&self, range: Option<&ScanRange>) -> Result<Option<BlockHeight>, Self::Error> {
        let blocks = self.lock()?;
        let highest = blocks.values().filter(|block| match range {
            Some(range) => range.block_range().contains(&Self::height_of(block)),
            None => true,
        }).map(Self::height_of).max();
        Ok(highest)
    }

    async fn read(&self, range: &ScanRange) -> Result<Vec<CompactBlock>, Self::Error> {
        let blocks = self.lock()?;
        let span = range.block_range();
        let start = u32::from(span.start);
        let end = u32::from(span.end);
        let mut found = Vec::new();
        for height in start..end {
            match blocks.get(&height) {
                Some(block) => found.push(block.clone()),
                None => break,
            }
        }
        Ok(found)
    }

    async fn insert(&self, compact_blocks: Vec<CompactBlock>) -> Result<(), Self::Error> {
        let mut blocks = self.lock()?;
        for block in compact_blocks {
            blocks.insert(block.height as u32, block);
        }
        Ok(())
    }

    async fn delete(&self, range: ScanRange) -> Result<(), Self::Error> {
        let mut blocks = self.lock()?;
        blocks.retain(|_, block| !range.block_range().contains(&Self::height_of(block)));
        Ok(())
    }
}
