# POLYON semantic vector scale boundary

POLYON keeps semantic vector search behind the existing SemanticVectorIndex interface.

The current exact implementation, ExactNormalizedSemanticVectorIndex, remains dependency-free and deterministic. The scale optimization in this slice is an in-memory candidate partition:

- embeddings are normalized once on insert/rebuild;
- candidates are bucketed by model ID and normalized vector dimension;
- search only scans the matching bucket;
- replacement removes the old bucket membership before inserting the new vector;
- removal cleans empty buckets;
- invalid or zero-length vectors remain excluded.

The ranking math is unchanged: normalized-vector dot product is still the exact cosine-equivalent score used by the previous implementation.

This reduces unnecessary candidate traversal when the durable embedding store contains multiple models or dimensions without introducing a second vector database, ANN dependency, paid service, or provider-specific implementation.

Future vector-scale work can replace the implementation behind SemanticVectorIndex without changing semantic-memory application contracts.
