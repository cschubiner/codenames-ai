"""Command-line interface for Codenames AI benchmarking."""

import asyncio
import json
from pathlib import Path
from typing import Optional

import click

from .game import BoardGenerator, Team
from .evaluation import AgentConfig
from .benchmark import BenchmarkRunner, RunnerConfig


@click.group()
def main():
    """Codenames AI Benchmarking CLI."""
    pass


@main.command()
@click.option("--count", "-n", default=100, help="Number of boards to generate")
@click.option("--output", "-o", required=True, type=click.Path(), help="Output file path")
@click.option("--seed", "-s", type=int, help="Random seed for reproducibility")
def generate_boards(count: int, output: str, seed: Optional[int]):
    """Generate a board set for benchmarking."""
    click.echo(f"Generating {count} boards...")

    generator = BoardGenerator()
    boards = generator.generate_board_set(count, base_seed=seed)

    output_path = Path(output)
    BoardGenerator.save_boards(boards, output_path)

    click.echo(f"Saved {count} boards to {output_path}")


@main.command()
@click.option("--config", "-c", required=True, type=click.Path(exists=True), help="Agent config JSON file")
@click.option("--boards", "-b", required=True, type=click.Path(exists=True), help="Board set JSON file")
@click.option("--output", "-o", type=click.Path(), help="Output results file")
@click.option("--replicates", "-r", default=1, help="Replicates per board")
@click.option("--no-mirror", is_flag=True, help="Disable mirror matches")
@click.option("--max-boards", type=int, help="Limit number of boards")
@click.option("--quiet", "-q", is_flag=True, help="Suppress verbose output")
def benchmark(
    config: str,
    boards: str,
    output: Optional[str],
    replicates: int,
    no_mirror: bool,
    max_boards: Optional[int],
    quiet: bool,
):
    """Run benchmark with an agent configuration."""
    click.echo(f"Loading config from {config}...")
    agent_config = AgentConfig.load_from_file(config)

    click.echo(f"Agent: {agent_config.name}")
    click.echo(f"Spymaster: {agent_config.spymaster.model}")
    click.echo(f"Guesser: {agent_config.guesser.model}")

    runner_config = RunnerConfig(verbose=not quiet)
    runner = BenchmarkRunner(agent_config, runner_config=runner_config)

    async def run():
        return await runner.run_on_board_set(
            Path(boards),
            replicates=replicates,
            mirror=not no_mirror,
            max_boards=max_boards,
        )

    click.echo(f"\nRunning benchmark...")
    metrics = asyncio.run(run())

    click.echo(f"\n{metrics.summary()}")

    if output:
        output_path = Path(output)
        metrics.save(output_path)
        click.echo(f"\nResults saved to {output_path}")


@main.command()
@click.option("--config", "-c", required=True, type=click.Path(exists=True), help="Agent config JSON file")
@click.option("--seed", "-s", type=int, default=42, help="Random seed for board")
def play_single(config: str, seed: int):
    """Play a single game with verbose output."""
    from .benchmark import GameRunner

    click.echo(f"Loading config from {config}...")
    agent_config = AgentConfig.load_from_file(config)

    click.echo(f"Generating board with seed {seed}...")
    generator = BoardGenerator()
    state = generator.generate_board(starting_team=Team.RED, seed=seed)

    click.echo(f"\nBoard words: {state.words}")
    click.echo(f"\nStarting game: {agent_config.name} vs {agent_config.name}")
    click.echo("=" * 60)

    runner_config = RunnerConfig(verbose=True)
    runner = GameRunner(agent_config, agent_config, config=runner_config)

    async def run():
        return await runner.run_game(state, f"single_game_seed_{seed}")

    metrics = asyncio.run(run())

    click.echo("\n" + "=" * 60)
    click.echo(f"Game finished!")
    click.echo(f"Winner: {metrics.winner.value.upper() if metrics.winner else 'None'}")
    click.echo(f"Total turns: {metrics.total_turns}")
    click.echo(f"Avg correct per clue: {metrics.correct_per_clue:.2f}")


@main.command()
@click.option("--output", "-o", required=True, type=click.Path(), help="Output config file")
@click.option("--name", "-n", default="custom", help="Config name")
@click.option("--spymaster-model", default="gpt-4o", help="Spymaster model")
@click.option("--guesser-model", default="gpt-4o-mini", help="Guesser model")
@click.option("--candidates", "-k", default=8, help="Candidates per turn")
@click.option("--rollouts", "-g", default=3, help="Rollouts per candidate")
@click.option("--aggregation", default="mean_minus_std",
              type=click.Choice(["mean", "mean_minus_std", "percentile_25", "cvar_25", "min"]),
              help="Aggregation strategy")
def create_config(
    output: str,
    name: str,
    spymaster_model: str,
    guesser_model: str,
    candidates: int,
    rollouts: int,
    aggregation: str,
):
    """Create a new agent configuration file."""
    config = {
        "name": name,
        "spymaster": {
            "model": spymaster_model,
            "prompt_id": "spymaster_v1",
            "temperature": 0.7,
            "candidates_per_turn": candidates,
        },
        "guesser": {
            "model": guesser_model,
            "prompt_id": "guesser_v1",
            "temperature": 0.2,
        },
        "selection": {
            "eval_samples_per_candidate": rollouts,
            "eval_temperature": 0.3,
            "aggregation": aggregation,
        },
    }

    output_path = Path(output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(config, f, indent=2)

    click.echo(f"Config saved to {output_path}")
    click.echo(json.dumps(config, indent=2))


@main.command()
@click.argument("result_files", nargs=-1, type=click.Path(exists=True))
def compare(result_files):
    """Compare results from multiple benchmark runs."""
    if len(result_files) < 2:
        click.echo("Please provide at least 2 result files to compare")
        return

    click.echo("Comparison of benchmark results:")
    click.echo("=" * 70)
    click.echo(f"{'Config':<20} {'Win Rate':<15} {'95% CI':<20} {'Assassin':<10}")
    click.echo("-" * 70)

    for result_file in result_files:
        with open(result_file) as f:
            data = json.load(f)

        name = data["config_name"][:20]
        win_rate = data["win_rate"]
        ci_low = data.get("win_rate_ci_low", 0)
        ci_high = data.get("win_rate_ci_high", 1)
        assassin = data["assassin_loss_rate"]

        click.echo(
            f"{name:<20} {win_rate:>6.1%}         "
            f"({ci_low:.1%} - {ci_high:.1%})      {assassin:>6.1%}"
        )


if __name__ == "__main__":
    main()
