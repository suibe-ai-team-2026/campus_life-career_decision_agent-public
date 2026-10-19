"""pytest 夹具：全部离线（fake DB / fake provider / 合成 fixtures）。"""

from __future__ import annotations

import pytest

from tests.fakes import FakeDb, FakeProvider, make_config


@pytest.fixture
def config():
    return make_config()


@pytest.fixture
def fake_db(config):
    return FakeDb(config=config)


@pytest.fixture
def fake_provider(config):
    return FakeProvider(config)
