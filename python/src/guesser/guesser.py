"""Guesser LLM interface using OpenAI Structured Outputs."""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from openai import AsyncOpenAI

from ..game import GameState, Team, Clue
from .schema_builder import build_guesser_schema


@dataclass
class Guess:
    """A single guess with confidence score."""
    word: str
    confidence: float


@dataclass
class GuesserOutput:
    """Complete output from the guesser."""
    guesses: list[Guess]
    reasoning: str
    stop_after: int  # 0 means use all guesses allowed


@dataclass
class GuesserConfig:
    """Configuration for the guesser."""
    model: str = "gpt-4o-mini"
    prompt_id: str = "guesser_v1"
    temperature: float = 0.2


class Guesser:
    """
    LLM-based Codenames guesser using OpenAI Structured Outputs.

    The guesser receives a clue and the current board state, then
    returns an ordered list of guesses with confidence scores.

    Key feature: The JSON Schema dynamically includes only unrevealed
    words as valid options, preventing hallucinated guesses.
    """

    def __init__(
        self,
        config: GuesserConfig,
        client: Optional[AsyncOpenAI] = None,
        prompts_dir: Optional[Path] = None,
    ):
        """
        Initialize the guesser.

        Args:
            config: Guesser configuration
            client: OpenAI client (creates one if not provided)
            prompts_dir: Directory containing prompt templates
        """
        self.config = config
        self.client = client or AsyncOpenAI()

        if prompts_dir is None:
            prompts_dir = Path(__file__).parent.parent.parent.parent.parent / "shared" / "prompts"
        self.prompts_dir = prompts_dir

        self._prompt_template = self._load_prompt()

    def _load_prompt(self) -> str:
        """Load the prompt template."""
        prompt_file = self.prompts_dir / f"{self.config.prompt_id}.txt"
        if not prompt_file.exists():
            raise FileNotFoundError(f"Prompt file not found: {prompt_file}")
        return prompt_file.read_text()

    def _format_prompt(
        self,
        state: GameState,
        clue: Clue,
    ) -> str:
        """Format the prompt with game state information."""
        unrevealed = state.get_unrevealed_words()

        return self._prompt_template.format(
            team=clue.team.value.upper(),
            team_remaining=state.red_remaining if clue.team == Team.RED else state.blue_remaining,
            opponent_remaining=state.blue_remaining if clue.team == Team.RED else state.red_remaining,
            clue=clue.word,
            number=clue.number,
            unrevealed_words="\n".join(f"- {w}" for w in unrevealed),
        )

    async def get_guesses(
        self,
        state: GameState,
        clue: Clue,
        temperature: Optional[float] = None,
    ) -> GuesserOutput:
        """
        Get guesses for a given clue and board state.

        Args:
            state: Current game state
            clue: The clue to respond to
            temperature: Override temperature (uses config if not specified)

        Returns:
            GuesserOutput with ordered guesses and reasoning
        """
        unrevealed = state.get_unrevealed_words()
        prompt = self._format_prompt(state, clue)
        schema = build_guesser_schema(unrevealed)

        response = await self.client.chat.completions.create(
            model=self.config.model,
            messages=[
                {"role": "user", "content": prompt}
            ],
            temperature=temperature or self.config.temperature,
            response_format={
                "type": "json_schema",
                "json_schema": schema,
            },
        )

        # Parse the structured response
        content = response.choices[0].message.content
        data = json.loads(content)

        guesses = [
            Guess(word=g["word"], confidence=g["confidence"])
            for g in data["guesses"]
        ]

        return GuesserOutput(
            guesses=guesses,
            reasoning=data["reasoning"],
            stop_after=data.get("stop_after", 0),
        )

    async def get_guesses_batch(
        self,
        state: GameState,
        clue: Clue,
        n: int,
        temperature: Optional[float] = None,
    ) -> list[GuesserOutput]:
        """
        Get multiple independent guess sets (for evaluation).

        Args:
            state: Current game state
            clue: The clue to respond to
            n: Number of independent guess sets to generate
            temperature: Override temperature

        Returns:
            List of GuesserOutput objects
        """
        import asyncio

        tasks = [
            self.get_guesses(state, clue, temperature)
            for _ in range(n)
        ]
        return await asyncio.gather(*tasks)

    def get_ordered_words(self, output: GuesserOutput, limit: Optional[int] = None) -> list[str]:
        """
        Extract ordered word list from guesser output.

        Args:
            output: GuesserOutput from get_guesses
            limit: Maximum number of words to return

        Returns:
            List of words in order of confidence
        """
        # Sort by confidence descending
        sorted_guesses = sorted(output.guesses, key=lambda g: g.confidence, reverse=True)

        # Apply stop_after recommendation if set
        if output.stop_after > 0:
            sorted_guesses = sorted_guesses[:output.stop_after]

        # Apply limit
        if limit is not None:
            sorted_guesses = sorted_guesses[:limit]

        return [g.word for g in sorted_guesses]
