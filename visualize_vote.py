#!/usr/bin/env python3
"""
Visualize vote results as a directed graph.
Same style as visualize_condorcet.py (Discord dark theme, magma colormap, blurple nodes).
"""

import sqlite3
import sys
import networkx as nx
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
import numpy as np
from collections import defaultdict


def get_vote_options(conn, vote_id):
    """Get options for a vote."""
    cursor = conn.execute(
        "SELECT id, label FROM vote_options WHERE vote_id = ? ORDER BY id",
        (vote_id,)
    )
    return {row[0]: row[1] for row in cursor.fetchall()}


def get_vote_preferences(conn, vote_id, user_id):
    """Get all preferences for a user in a vote."""
    cursor = conn.execute(
        "SELECT option_a_id, option_b_id, preference FROM vote_preferences WHERE vote_id = ? AND user_id = ?",
        (vote_id, user_id)
    )
    return cursor.fetchall()


def compute_user_rankings(prefs, option_ids_set):
    """Compute a user's ranking via topological sort (same algorithm as the TS code)."""
    if not prefs:
        return {}

    compared = set()
    for a, b, p in prefs:
        compared.add(a)
        compared.add(b)

    to_rank = [oid for oid in compared if oid in option_ids_set]
    if not to_rank:
        return {}

    to_rank_set = set(to_rank)

    graph = defaultdict(set)
    in_degree = {oid: 0 for oid in to_rank}

    for a, b, p in prefs:
        if a not in to_rank_set or b not in to_rank_set:
            continue
        if p > 0:
            if b not in graph[a]:
                graph[a].add(b)
                in_degree[b] += 1
        elif p < 0:
            if a not in graph[b]:
                graph[b].add(a)
                in_degree[a] += 1

    # Connected components
    comp_graph = defaultdict(set)
    for a, b, p in prefs:
        if a in to_rank_set and b in to_rank_set:
            comp_graph[a].add(b)
            comp_graph[b].add(a)

    visited = set()
    components = []
    for oid in to_rank:
        if oid in visited:
            continue
        component = []
        stack = [oid]
        while stack:
            node = stack.pop()
            if node in visited:
                continue
            visited.add(node)
            component.append(node)
            for n in comp_graph.get(node, []):
                if n not in visited:
                    stack.append(n)
        components.append(component)

    components.sort(key=lambda x: -len(x))
    main = set(components[0]) if components else set()

    comp_in_deg = {oid: 0 for oid in main}
    for f in main:
        for t in graph.get(f, []):
            if t in main:
                comp_in_deg[t] += 1

    rank_map = {}
    remaining = set(main)
    rank = 1
    while remaining:
        sources = [oid for oid in remaining if comp_in_deg.get(oid, 0) == 0]
        if not sources:
            break
        for oid in sources:
            rank_map[oid] = rank
            remaining.discard(oid)
            for n in graph.get(oid, []):
                if n in remaining:
                    comp_in_deg[n] -= 1
        rank += 1

    return rank_map


def compute_vote_matrix(conn, vote_id):
    """Compute pairwise comparison matrix for a vote."""
    options = get_vote_options(conn, vote_id)
    option_ids = list(options.keys())
    labels = [options[oid] for oid in option_ids]
    n = len(option_ids)
    option_ids_set = set(option_ids)

    cursor = conn.execute(
        "SELECT DISTINCT user_id FROM vote_preferences WHERE vote_id = ?",
        (vote_id,)
    )
    voters = [row[0] for row in cursor.fetchall()]

    matrix = np.zeros((n, n), dtype=int)
    if not voters:
        return option_ids, labels, matrix

    user_rankings = {}
    for uid in voters:
        prefs = get_vote_preferences(conn, vote_id, uid)
        if prefs:
            user_rankings[uid] = compute_user_rankings(prefs, option_ids_set)

    for i, a in enumerate(option_ids):
        for j, b in enumerate(option_ids):
            if i == j:
                continue
            for uid, rank_map in user_rankings.items():
                ra = rank_map.get(a)
                rb = rank_map.get(b)
                if ra is not None and rb is not None:
                    if ra < rb:
                        matrix[i][j] += 1
                elif ra is not None and rb is None:
                    matrix[i][j] += 1

    return option_ids, labels, matrix


def create_vote_graph(option_ids, labels, matrix, output_path):
    """Create a force-directed graph matching visualize_condorcet.py style."""
    G = nx.DiGraph()
    n = len(option_ids)

    wins = {i: 0 for i in range(n)}
    losses = {i: 0 for i in range(n)}
    for i in range(n):
        for j in range(n):
            if i != j:
                if matrix[i][j] > matrix[j][i]:
                    wins[i] += 1
                elif matrix[i][j] < matrix[j][i]:
                    losses[i] += 1

    for i, label in enumerate(labels):
        G.add_node(i, label=label)

    edge_data = []
    for i in range(n):
        for j in range(n):
            if i != j:
                votes_for = matrix[i][j]
                votes_against = matrix[j][i]
                if votes_for > votes_against:
                    margin = votes_for - votes_against
                    G.add_edge(j, i, weight=margin, votes=f"{votes_for}-{votes_against}")
                    edge_data.append((j, i, margin))

    if not edge_data:
        # No edges — create a simple node-only plot
        DISCORD_BG = '#1a1a1e'
        fig, ax = plt.subplots(1, 1, figsize=(12, 10))
        fig.patch.set_facecolor(DISCORD_BG)
        ax.set_facecolor(DISCORD_BG)
        pos = nx.spring_layout(G, k=2.0, seed=42)
        nx.draw_networkx_nodes(G, pos, ax=ax, node_color='#5865F2', node_size=3500, alpha=0.95)
        for i in range(n):
            x, y = pos[i]
            title = labels[i][:11] + '..' if len(labels[i]) > 12 else labels[i]
            ax.text(x, y, title, fontsize=8, ha='center', va='center', fontweight='bold', color='white')
        ax.set_title("Vote Results", fontsize=13, pad=15, color='white')
        ax.axis('off')
        plt.tight_layout()
        plt.savefig(output_path, dpi=150, bbox_inches='tight', facecolor=DISCORD_BG)
        plt.close()
        return

    margins = [e[2] for e in edge_data]
    norm = mcolors.Normalize(vmin=min(margins), vmax=max(margins))
    cmap = plt.cm.magma.resampled(256)
    cmap = mcolors.LinearSegmentedColormap.from_list(
        'magma_purple', cmap(np.linspace(0.25, 1.0, 256))
    )

    DISCORD_BG = '#1a1a1e'

    fig, ax = plt.subplots(1, 1, figsize=(20, 18))
    fig.patch.set_facecolor(DISCORD_BG)
    ax.set_facecolor(DISCORD_BG)

    pos = nx.spring_layout(G, k=3.0, iterations=200, seed=42, scale=2.5)

    nx.draw_networkx_nodes(
        G, pos, ax=ax,
        node_color='#5865F2',
        node_size=3500,
        alpha=0.95,
        edgecolors='#7289DA',
        linewidths=2
    )

    edges = G.edges(data=True)
    edge_colors = [cmap(norm(d['weight'])) for u, v, d in edges]
    edge_widths = [0.8 + 2.0 * norm(d['weight']) for u, v, d in edges]

    nx.draw_networkx_edges(
        G, pos, ax=ax,
        edge_color=edge_colors,
        width=edge_widths,
        arrows=True,
        arrowsize=25,
        arrowstyle='-|>',
        connectionstyle="arc3,rad=0.2",
        min_source_margin=35,
        min_target_margin=35
    )

    for i in range(n):
        x, y = pos[i]
        title = labels[i]
        if len(title) > 12:
            title = title[:11] + '..'
        ax.text(x, y, title, fontsize=8, ha='center', va='center',
                fontweight='bold', color='white')

    for i in range(n):
        x, y = pos[i]
        score = f"{wins[i]}-{losses[i]}"
        ax.text(x, y - 0.22, score, fontsize=9, ha='center', va='center',
                fontweight='bold', color='#aaaaaa')

    sm = plt.cm.ScalarMappable(cmap=cmap, norm=norm)
    sm.set_array([])
    cbar = plt.colorbar(sm, ax=ax, shrink=0.5, pad=0.02)
    cbar.set_label('Win Margin', fontsize=11, color='white')
    cbar.ax.yaxis.set_tick_params(color='white')
    plt.setp(plt.getp(cbar.ax.axes, 'yticklabels'), color='white')

    ax.set_title("Vote Results\n"
                 "Arrows point to winner", fontsize=13, pad=15, color='white')
    ax.axis('off')
    plt.tight_layout()
    plt.savefig(output_path, dpi=150, bbox_inches='tight', facecolor=DISCORD_BG)
    plt.close()


def main():
    db_path = None
    vote_id = None
    output_path = None

    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--db" and i + 1 < len(args):
            db_path = args[i + 1]
            i += 2
        elif args[i] == "--vote-id" and i + 1 < len(args):
            vote_id = int(args[i + 1])
            i += 2
        elif args[i] == "--output" and i + 1 < len(args):
            output_path = args[i + 1]
            i += 2
        else:
            i += 1

    if not db_path or vote_id is None or not output_path:
        print("Usage: visualize_vote.py --db <path> --vote-id <id> --output <path>")
        sys.exit(1)

    conn = sqlite3.connect(db_path)
    option_ids, labels, matrix = compute_vote_matrix(conn, vote_id)
    conn.close()

    if not option_ids:
        print("No options found for this vote.")
        sys.exit(1)

    create_vote_graph(option_ids, labels, matrix, output_path)


if __name__ == "__main__":
    main()
