"""Golden ProteinMPNN outputs for @molgpu/nn's parity test, computed by the
upstream PyTorch code on the converted (fp16-rounded) weights.

    python -I proteinmpnn_reference.py <ProteinMPNN checkout> weights.safetensors \
        backbones.json reference.json

backbones.json comes from export_backbones.ts. For each structure it records
the neighbour graph and log-probabilities for: structure only
(`unconditional_probs`), a fixed random decoding order (`forward`), and
all-but-self (`forward`'s decoder with every other neighbour visible).
"""

import json
import sys

import numpy as np
import torch
from safetensors.torch import load_file

checkout, weights, inputs, out = sys.argv[1:5]
sys.path.insert(0, checkout)
from protein_mpnn_utils import ProteinMPNN, cat_neighbors_nodes, gather_nodes  # noqa: E402

torch.set_grad_enabled(False)
model = ProteinMPNN(
    num_letters=21, node_features=128, edge_features=128, hidden_dim=128,
    num_encoder_layers=3, num_decoder_layers=3, augment_eps=0.0, k_neighbors=48,
)
model.load_state_dict({k: v.float() for k, v in load_file(weights).items()})
model.eval()


def all_but_self(X, S, mask, residue_idx, chain):
    """forward() with mask_attend = 1 for every neighbour except the residue itself."""
    E, E_idx = model.features(X, mask, residue_idx, chain)
    h_V = torch.zeros((E.shape[0], E.shape[1], E.shape[-1]))
    h_E = model.W_e(E)
    mask_attend = mask.unsqueeze(-1) * gather_nodes(mask.unsqueeze(-1), E_idx).squeeze(-1)
    for layer in model.encoder_layers:
        h_V, h_E = layer(h_V, h_E, E_idx, mask, mask_attend)
    h_ES = cat_neighbors_nodes(model.W_s(S), h_E, E_idx)
    h_EX = cat_neighbors_nodes(torch.zeros_like(h_V), h_E, E_idx)
    h_EXV = cat_neighbors_nodes(h_V, h_EX, E_idx)
    self_index = torch.arange(E_idx.shape[1])[None, :, None]
    mask_bw = (E_idx != self_index).float().unsqueeze(-1)
    h_EXV_fw = (1.0 - mask_bw) * h_EXV
    for layer in model.decoder_layers:
        h_ESV = mask_bw * cat_neighbors_nodes(h_V, h_ES, E_idx) + h_EXV_fw
        h_V = layer(h_V, h_ESV, mask)
    return torch.log_softmax(model.W_out(h_V), -1)


def rounded(array):
    return [float(f"{v:.7g}") for v in np.asarray(array).reshape(-1)]


reference = {}
for name, entry in json.load(open(inputs)).items():
    L = len(entry["sequence"])
    X = torch.tensor(entry["backbone"], dtype=torch.float32).view(1, L, 4, 3)
    S = torch.tensor(entry["sequence"], dtype=torch.long)[None]
    residue_idx = torch.tensor(entry["residueIndex"], dtype=torch.long)[None]
    chain = torch.tensor(entry["chain"], dtype=torch.long)[None]
    mask = torch.ones(1, L)
    _, E_idx = model.features(X, mask, residue_idx, chain)
    order = torch.from_numpy(np.random.default_rng(7).permutation(L))[None]
    forward = model(X, S, mask, mask, residue_idx, chain, torch.zeros(1, L),
                    use_input_decoding_order=True, decoding_order=order)
    reference[name] = {
        "neighbors": E_idx[0].reshape(-1).tolist(),
        "order": order[0].tolist(),
        "none": rounded(model.unconditional_probs(X, mask, residue_idx, chain)[0]),
        "order_log_probs": rounded(forward[0]),
        "all_but_self": rounded(all_but_self(X, S, mask, residue_idx, chain)[0]),
    }
    print(f"{name}: L={L}")
json.dump(reference, open(out, "w"))
