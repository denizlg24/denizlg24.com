"""Vercel entry point for POST /api/classify."""

from email_classifier.http_api import handler

__all__ = ["handler"]
