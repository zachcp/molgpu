"""Convert a ProteinMPNN checkpoint (.pt) to fp16 safetensors under its
state_dict names, for @molgpu/nn.

    python -I convert_proteinmpnn.py ProteinMPNN/vanilla_model_weights/v_48_020.pt out.safetensors

Needs torch and safetensors. Checkpoints: https://github.com/dauparas/ProteinMPNN
(MIT). The header metadata records the source file's SHA-256 and noise level.
"""

import hashlib
import sys

import torch
from safetensors.torch import save_file

source, target = sys.argv[1], sys.argv[2]
checkpoint = torch.load(source, map_location="cpu", weights_only=False)
tensors = {
    name: value.to(torch.float16).contiguous()
    for name, value in checkpoint["model_state_dict"].items()
}
with open(source, "rb") as handle:
    digest = hashlib.sha256(handle.read()).hexdigest()
save_file(
    tensors,
    target,
    metadata={
        "source": source.rsplit("/", 1)[-1],
        "source_sha256": digest,
        "num_edges": str(checkpoint["num_edges"]),
        "noise_level": str(checkpoint["noise_level"]),
        "upstream": "https://github.com/dauparas/ProteinMPNN",
        "license": "MIT",
    },
)
print(f"{len(tensors)} tensors -> {target}")
