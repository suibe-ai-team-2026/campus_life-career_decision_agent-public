"""资料入库：解析 → 切块 → embedding → 写 app_chunks / app_chunk_embeddings。"""

from . import chunking, parsers

__all__ = ["chunking", "parsers"]
