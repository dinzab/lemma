"""
This is the main entry point for the agent.
It imports the compiled graph from graph.py.
"""

from graph import graph

# The graph is exposed here for LangGraph to pick up
__all__ = ["graph"]
