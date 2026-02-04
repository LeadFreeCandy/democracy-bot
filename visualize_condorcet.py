#!/usr/bin/env python3
"""
Visualize Condorcet matrix as directed graphs.
Matches the algorithm in src/database/queries.ts exactly.
"""

import sqlite3
import networkx as nx
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
import numpy as np
from collections import defaultdict
import datetime

DB_PATH = "./data/movies.db"


def get_unwatched_movies(conn):
    """Get all unwatched movies."""
    cursor = conn.execute(
        "SELECT id, title FROM movies WHERE watched = 0 ORDER BY id"
    )
    return {row[0]: row[1] for row in cursor.fetchall()}


def get_next_wednesday():
    """Get next Wednesday date in YYYY-MM-DD format."""
    today = datetime.date.today()
    day_of_week = today.weekday()  # Monday = 0, Wednesday = 2
    days_until_wed = (2 - day_of_week + 7) % 7
    if days_until_wed == 0:
        days_until_wed = 0  # Today is Wednesday, keep it
    next_wed = today + datetime.timedelta(days=days_until_wed)
    return next_wed.strftime("%Y-%m-%d")


def get_attendees(conn, event_date):
    """Get attendees for a specific date."""
    cursor = conn.execute(
        "SELECT user_id FROM attendance WHERE event_date = ? AND attending = 1",
        (event_date,)
    )
    return [row[0] for row in cursor.fetchall()]


def get_user_preferences(conn, user_id):
    """Get all pairwise preferences for a user."""
    cursor = conn.execute(
        "SELECT movie_a_id, movie_b_id, preference FROM pairwise_preferences WHERE user_id = ?",
        (user_id,)
    )
    return cursor.fetchall()


def compute_user_rankings(prefs, unwatched_movie_ids):
    """
    Compute a user's ranking using the exact algorithm from queries.ts.
    Returns (rank_map, unranked_set) where rank_map maps movieId -> rank number.
    """
    if not prefs:
        return {}, set()

    # Get all movies the user has compared
    compared_movie_ids = set()
    for movie_a, movie_b, pref in prefs:
        compared_movie_ids.add(movie_a)
        compared_movie_ids.add(movie_b)

    # Filter to only unwatched movies
    movies_to_rank = [mid for mid in compared_movie_ids if mid in unwatched_movie_ids]
    if not movies_to_rank:
        return {}, set()

    movie_ids_set = set(movies_to_rank)

    # Track compared pairs
    compared_pairs = set()
    for movie_a, movie_b, pref in prefs:
        compared_pairs.add(f"{movie_a}:{movie_b}")
        compared_pairs.add(f"{movie_b}:{movie_a}")

    # Build directed graph: edge A->B means A preferred over B
    graph = defaultdict(set)
    in_degree = {mid: 0 for mid in movies_to_rank}

    for movie_a, movie_b, pref in prefs:
        if movie_a not in movie_ids_set or movie_b not in movie_ids_set:
            continue
        if pref > 0:
            # A preferred over B
            if movie_b not in graph[movie_a]:
                graph[movie_a].add(movie_b)
                in_degree[movie_b] += 1
        elif pref < 0:
            # B preferred over A
            if movie_a not in graph[movie_b]:
                graph[movie_b].add(movie_a)
                in_degree[movie_a] += 1
        # pref == 0: explicit tie, no edge

    # Build undirected comparison graph for connectivity
    comparison_graph = defaultdict(set)
    for movie_a, movie_b, pref in prefs:
        if movie_a in movie_ids_set and movie_b in movie_ids_set:
            comparison_graph[movie_a].add(movie_b)
            comparison_graph[movie_b].add(movie_a)

    # Find connected components using comparison graph
    visited = set()
    components = []

    def dfs(start):
        component = []
        stack = [start]
        while stack:
            node = stack.pop()
            if node in visited:
                continue
            visited.add(node)
            component.append(node)
            for neighbor in comparison_graph.get(node, []):
                if neighbor not in visited:
                    stack.append(neighbor)
        return component

    for mid in movies_to_rank:
        if mid not in visited:
            components.append(dfs(mid))

    # Find largest component
    components.sort(key=lambda x: -len(x))
    main_component = set(components[0]) if components else set()
    unranked_ids = [mid for mid in movies_to_rank if mid not in main_component]

    # Topological sort the main component
    rank_map = {}
    remaining = set(main_component)
    current_rank = 1

    # Recalculate in-degrees for main component only
    component_in_degree = {mid: 0 for mid in main_component}
    for from_node in main_component:
        for to_node in graph.get(from_node, []):
            if to_node in main_component:
                component_in_degree[to_node] += 1

    while remaining:
        # Find nodes with in-degree 0
        sources = [mid for mid in remaining if component_in_degree.get(mid, 0) == 0]

        if not sources:
            # Cycle detected - add remaining as unranked
            unranked_ids.extend(remaining)
            break

        # Process all sources at current rank
        for mid in sources:
            rank_map[mid] = current_rank
            remaining.discard(mid)
            for neighbor in graph.get(mid, []):
                if neighbor in remaining:
                    component_in_degree[neighbor] -= 1

        current_rank += 1

    return rank_map, set(unranked_ids)


def compute_condorcet_matrix(conn, verbose=False):
    """Compute the Condorcet pairwise comparison matrix using the exact algorithm."""
    movies = get_unwatched_movies(conn)
    movie_ids = list(movies.keys())
    movie_titles = [movies[mid] for mid in movie_ids]
    n = len(movie_ids)
    movie_ids_set = set(movie_ids)

    # Get attendees
    event_date = get_next_wednesday()
    attendees = get_attendees(conn, event_date)
    if verbose:
        print(f"Event date: {event_date}")
        print(f"Found {len(attendees)} attendees")

    if not attendees:
        # Fall back to all users
        cursor = conn.execute("SELECT DISTINCT user_id FROM pairwise_preferences")
        attendees = [row[0] for row in cursor.fetchall()]
        if verbose:
            print(f"Using all {len(attendees)} voters instead")

    # Compute rankings for each attendee
    user_rankings = {}
    for user_id in attendees:
        prefs = get_user_preferences(conn, user_id)
        if prefs:
            rank_map, unranked_set = compute_user_rankings(prefs, movie_ids_set)
            user_rankings[user_id] = {"rank_map": rank_map, "unranked_set": unranked_set}
            if verbose:
                print(f"  User {user_id[:8]}...: {len(rank_map)} ranked, {len(unranked_set)} unranked")

    # Build matrix
    matrix = np.zeros((n, n), dtype=int)

    for i, movie_a in enumerate(movie_ids):
        for j, movie_b in enumerate(movie_ids):
            if i == j:
                continue

            for user_id, ranking in user_rankings.items():
                rank_map = ranking["rank_map"]

                rank_a = rank_map.get(movie_a)
                rank_b = rank_map.get(movie_b)

                if rank_a is not None and rank_b is not None:
                    # Both ranked - compare (lower rank = better)
                    if rank_a < rank_b:
                        matrix[i][j] += 1
                elif rank_a is not None and rank_b is None:
                    # A is ranked, B is not - A wins
                    matrix[i][j] += 1
                # Otherwise no vote for A over B

    return movie_ids, movie_titles, matrix


def compute_ranked_pairs(movie_ids, movie_titles, matrix):
    """Compute final ranking using Ranked Pairs (Tideman) method."""
    n = len(movie_ids)

    # Collect pairs with margins
    pairs = []
    for i in range(n):
        for j in range(i + 1, n):
            votes_i = matrix[i][j]
            votes_j = matrix[j][i]
            if votes_i > votes_j:
                pairs.append((i, j, votes_i - votes_j, votes_i))
            elif votes_j > votes_i:
                pairs.append((j, i, votes_j - votes_i, votes_j))
            # If tie, no pair added

    # Sort by margin (highest first), then by total votes as tiebreaker
    pairs.sort(key=lambda x: (-x[2], -x[3]))

    # Lock pairs without creating cycles
    locked = defaultdict(set)

    def would_create_cycle(winner, loser):
        visited = set()
        stack = [loser]
        while stack:
            current = stack.pop()
            if current == winner:
                return True
            if current in visited:
                continue
            visited.add(current)
            stack.extend(locked.get(current, []))
        return False

    for winner, loser, margin, _ in pairs:
        if not would_create_cycle(winner, loser):
            locked[winner].add(loser)

    # Topological sort for final ranking
    in_degree = {i: 0 for i in range(n)}
    for winner, losers in locked.items():
        for loser in losers:
            in_degree[loser] += 1

    ranking = []
    remaining = set(range(n))

    while remaining:
        sources = [i for i in remaining if in_degree[i] == 0]
        if not sources:
            # Add remaining alphabetically
            remaining_sorted = sorted(remaining, key=lambda i: movie_titles[i])
            ranking.extend(remaining_sorted)
            break

        # Sort sources alphabetically for deterministic ordering
        sources.sort(key=lambda i: movie_titles[i])
        for s in sources:
            ranking.append(s)
            remaining.discard(s)
            for neighbor in locked.get(s, []):
                in_degree[neighbor] -= 1

    return ranking, locked


def create_loose_graph(movie_ids, movie_titles, matrix, output_path="condorcet_loose.png"):
    """Create a force-directed graph with loose spacing."""
    G = nx.DiGraph()
    n = len(movie_ids)

    # Compute wins/losses from head-to-head matrix (not locked pairs)
    # This matches what's shown in the graph edges
    wins = {i: 0 for i in range(n)}
    losses = {i: 0 for i in range(n)}
    for i in range(n):
        for j in range(n):
            if i != j:
                if matrix[i][j] > matrix[j][i]:
                    wins[i] += 1
                elif matrix[i][j] < matrix[j][i]:
                    losses[i] += 1

    # Add nodes
    for i, title in enumerate(movie_titles):
        G.add_node(i, label=title)

    # Add edges: arrow points TO the winner (loser → winner)
    # So if i beats j, we add edge j → i
    edge_data = []
    edge_labels = {}
    for i in range(n):
        for j in range(n):
            if i != j:
                votes_for = matrix[i][j]
                votes_against = matrix[j][i]
                if votes_for > votes_against:
                    margin = votes_for - votes_against
                    # Arrow from loser (j) to winner (i)
                    G.add_edge(j, i, weight=margin, votes=f"{votes_for}-{votes_against}")
                    edge_data.append((j, i, margin))
                    edge_labels[(j, i)] = f"{votes_for}-{votes_against}"

    if not edge_data:
        print("No edges to display!")
        return

    margins = [e[2] for e in edge_data]
    norm = mcolors.Normalize(vmin=min(margins), vmax=max(margins))
    cmap = plt.cm.RdYlGn

    # Discord dark theme background color
    DISCORD_BG = '#1a1a1e'

    # Create figure with Discord background
    fig, ax = plt.subplots(1, 1, figsize=(20, 18))
    fig.patch.set_facecolor(DISCORD_BG)
    ax.set_facecolor(DISCORD_BG)

    # Use spring layout with high repulsion for better separation
    pos = nx.spring_layout(G, k=3.0, iterations=200, seed=42, scale=2.5)

    # Draw edges (no transparency)
    edges = G.edges(data=True)
    edge_colors = [cmap(norm(d['weight'])) for u, v, d in edges]
    edge_widths = [0.8 + 2.0 * norm(d['weight']) for u, v, d in edges]

    nx.draw_networkx_edges(
        G, pos, ax=ax,
        edge_color=edge_colors,
        width=edge_widths,
        arrows=True,
        arrowsize=20,
        connectionstyle="arc3,rad=0.15",
        min_source_margin=30,
        min_target_margin=30
    )


    # Draw nodes
    nx.draw_networkx_nodes(
        G, pos, ax=ax,
        node_color='#5865F2',  # Discord blurple
        node_size=3500,
        alpha=0.95,
        edgecolors='#7289DA',
        linewidths=2
    )

    # Draw movie name inside nodes
    for i in range(n):
        x, y = pos[i]
        title = movie_titles[i]
        # Truncate and wrap long titles
        if len(title) > 12:
            title = title[:11] + '..'
        ax.text(x, y, title, fontsize=8, ha='center', va='center',
                fontweight='bold', color='white')

    # Draw W-L score below nodes
    for i in range(n):
        x, y = pos[i]
        score = f"{wins[i]}-{losses[i]}"
        ax.text(x, y - 0.22, score, fontsize=9, ha='center', va='center',
                fontweight='bold', color='#aaaaaa')

    # Colorbar with light text
    sm = plt.cm.ScalarMappable(cmap=cmap, norm=norm)
    sm.set_array([])
    cbar = plt.colorbar(sm, ax=ax, shrink=0.5, pad=0.02)
    cbar.set_label('Win Margin', fontsize=11, color='white')
    cbar.ax.yaxis.set_tick_params(color='white')
    plt.setp(plt.getp(cbar.ax.axes, 'yticklabels'), color='white')

    ax.set_title("Condorcet Preferences\n"
                 "Arrows point to winner · Green = Strong win · Red = Close race", fontsize=13, pad=15, color='white')
    ax.axis('off')
    plt.tight_layout()
    plt.savefig(output_path, dpi=150, bbox_inches='tight', facecolor=DISCORD_BG)
    plt.close()


def create_ranked_graph(movie_ids, movie_titles, matrix, output_path="condorcet_ranked.png"):
    """Create a ranked/layered graph based on Tideman ranking."""
    ranking, locked = compute_ranked_pairs(movie_ids, movie_titles, matrix)

    G = nx.DiGraph()
    n = len(movie_ids)

    for i in range(n):
        G.add_node(i)

    # Add only locked edges
    edge_data = []
    for winner, losers in locked.items():
        for loser in losers:
            margin = matrix[winner][loser] - matrix[loser][winner]
            G.add_edge(winner, loser, weight=max(1, margin))
            edge_data.append(margin)

    if not edge_data:
        print("No locked edges!")
        return

    # Position: rank determines Y, slight X offset for visual interest
    pos = {}
    for rank_pos, node_idx in enumerate(ranking):
        # Add slight horizontal jitter based on connections
        x_offset = (hash(movie_titles[node_idx]) % 100) / 200 - 0.25
        pos[node_idx] = (x_offset, -rank_pos * 1.2)

    norm = mcolors.Normalize(vmin=min(edge_data), vmax=max(edge_data))
    cmap = plt.cm.RdYlGn

    # Discord dark theme background color
    DISCORD_BG = '#1a1a1e'

    # Create figure with Discord background
    fig, ax = plt.subplots(1, 1, figsize=(12, 20))
    fig.patch.set_facecolor(DISCORD_BG)
    ax.set_facecolor(DISCORD_BG)

    # Compute wins/losses
    wins = {i: len(locked.get(i, [])) for i in range(n)}
    losses = {i: sum(1 for w, losers in locked.items() if i in losers) for i in range(n)}

    # Draw edges with better curves
    edges = G.edges(data=True)
    edge_colors = [cmap(norm(d['weight'])) for u, v, d in edges]
    edge_widths = [0.8 + 1.5 * norm(d['weight']) for u, v, d in edges]

    # Draw edges to the left of nodes
    edge_pos = {node: (x - 0.3, y) for node, (x, y) in pos.items()}
    nx.draw_networkx_edges(
        G, edge_pos, ax=ax,
        edge_color=edge_colors,
        width=edge_widths,
        alpha=0.35,
        arrows=True,
        arrowsize=10,
        connectionstyle="arc3,rad=0.3"
    )

    # Node colors by rank
    rank_norm = mcolors.Normalize(vmin=0, vmax=n-1)
    rank_cmap = plt.cm.viridis_r
    node_colors = [rank_cmap(rank_norm(ranking.index(i))) for i in range(n)]

    nx.draw_networkx_nodes(
        G, edge_pos, ax=ax,
        node_color=node_colors,
        node_size=2200,
        alpha=0.95,
        edgecolors='white',
        linewidths=2
    )

    # Draw W-L score inside nodes
    for node_idx in range(n):
        x, y = edge_pos[node_idx]
        score = f"{wins[node_idx]}-{losses[node_idx]}"
        ax.text(x, y, score, fontsize=9, ha='center', va='center',
                fontweight='bold', color='white')

    # Labels to the right of nodes (white text for dark background)
    for node_idx in range(n):
        x, y = edge_pos[node_idx]
        rank_pos = ranking.index(node_idx) + 1
        label = f"#{rank_pos}  {movie_titles[node_idx]}"
        ax.text(x + 0.3, y, label, fontsize=11, ha='left', va='center', fontweight='bold', color='white')

    # Colorbar with light text
    sm = plt.cm.ScalarMappable(cmap=cmap, norm=norm)
    sm.set_array([])
    cbar = plt.colorbar(sm, ax=ax, shrink=0.3, location='left', pad=0.15)
    cbar.set_label('Win margin', fontsize=10, color='white')
    cbar.ax.yaxis.set_tick_params(color='white')
    plt.setp(plt.getp(cbar.ax.axes, 'yticklabels'), color='white')

    ax.set_title("Condorcet Rankings (Tideman/Ranked Pairs)\n"
                 "Top = Best, Arrows show locked wins", fontsize=14, pad=20, color='white')
    ax.axis('off')

    # Adjust limits
    min_y = min(p[1] for p in pos.values())
    max_y = max(p[1] for p in pos.values())
    ax.set_xlim(-1, 4)
    ax.set_ylim(min_y - 0.5, max_y + 0.5)

    plt.savefig(output_path, dpi=150, bbox_inches='tight', facecolor=DISCORD_BG)
    plt.close()


def main():
    import sys

    # Check for command line args
    output_path = None
    graph_type = "both"
    verbose = True

    args = sys.argv[1:]
    for i, arg in enumerate(args):
        if arg == "--output" and i + 1 < len(args):
            output_path = args[i + 1]
        elif arg == "--loose":
            graph_type = "loose"
        elif arg == "--ranked":
            graph_type = "ranked"
        elif arg == "--quiet":
            verbose = False

    conn = sqlite3.connect(DB_PATH)

    if verbose:
        print("=" * 60)
        print("Computing Condorcet matrix (matching queries.ts algorithm)")
        print("=" * 60)

    movie_ids, movie_titles, matrix = compute_condorcet_matrix(conn, verbose=verbose)
    n = len(movie_ids)

    if verbose:
        print(f"\n{n} Movies: {movie_titles}\n")

        # Print matrix
        print("Condorcet Matrix (row beats column by this many votes):")
        max_title = 12
        header = " " * (max_title + 2)
        for t in movie_titles:
            header += t[:5].rjust(6)
        print(header)
        print("-" * len(header))

        for i, title in enumerate(movie_titles):
            row = title[:max_title].ljust(max_title) + " |"
            for j in range(n):
                if i == j:
                    row += "   -  "
                else:
                    row += f"{matrix[i][j]:4d}  "
            print(row)

        # Compute and display ranking
        print("\n" + "=" * 60)
        print("Final Rankings (Tideman/Ranked Pairs)")
        print("=" * 60)

        ranking, locked = compute_ranked_pairs(movie_ids, movie_titles, matrix)

        for rank_pos, node_idx in enumerate(ranking):
            wins = len(locked.get(node_idx, []))
            losses = sum(1 for w, losers in locked.items() if node_idx in losers)
            print(f"  #{rank_pos + 1:2d}  {movie_titles[node_idx]:<30}  W:{wins} L:{losses}")

        print("\n" + "=" * 60)
        print("Generating visualizations...")
        print("=" * 60)

    # Generate requested graphs
    if graph_type in ("both", "loose"):
        loose_path = output_path if output_path and graph_type == "loose" else "condorcet_loose.png"
        create_loose_graph(movie_ids, movie_titles, matrix, loose_path)

    if graph_type in ("both", "ranked"):
        ranked_path = output_path if output_path and graph_type == "ranked" else "condorcet_ranked.png"
        create_ranked_graph(movie_ids, movie_titles, matrix, ranked_path)

    conn.close()
    if verbose:
        print("\nDone!")


if __name__ == "__main__":
    main()
