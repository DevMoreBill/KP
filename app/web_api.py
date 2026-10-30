"""Адреса HTTP-API: контроллеры разделов (web_*.py) в порядке поиска маршрута — первый подходящий по пути и методу."""

from web_base import Router
from web_catalog import CatalogController, TypesController
from web_crm import CrmController, TrackController
from web_kp import DraftsController, KpController, KpFilesController, TemplatesController
from web_refs import (
    ClientCardController,
    DealController,
    GeoController,
    ManagersController,
    OurDocsController,
    PartiesController,
)
from web_settings import MeController, OneCController, ServiceController, SettingsController, SystemController
from web_static import StaticController
from web_tools import ToolsController

CONTROLLERS = (
    StaticController,
    TypesController,
    GeoController,
    PartiesController,
    TemplatesController,
    SystemController,
    CatalogController,
    ManagersController,
    KpController,
    KpFilesController,
    ToolsController,
    SettingsController,
    DealController,
    TrackController,
    DraftsController,
    ClientCardController,
    CrmController,
    MeController,
    ServiceController,
    OurDocsController,
    OneCController,
)

ROUTER = Router(CONTROLLERS)
