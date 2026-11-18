"""Config flow for Hakanban (single instance), plus options for link previews."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers.selector import TextSelector, TextSelectorConfig

from .const import CONF_PREVIEW_HOSTS, DOMAIN, PANEL_TITLE
from .link_preview import Policy

OPTIONS_SCHEMA = vol.Schema(
    {vol.Optional(CONF_PREVIEW_HOSTS, default=""): TextSelector(TextSelectorConfig(multiline=True))}
)


class HakanbanConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Hakanban."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Single-click setup — there is nothing to configure."""
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")
        if user_input is not None:
            return self.async_create_entry(title=PANEL_TITLE, data={})
        return self.async_show_form(step_id="user")

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return HakanbanOptionsFlow()


class HakanbanOptionsFlow(OptionsFlow):
    """Link previews: hosts on your own network that may be fetched."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        placeholders = {"entry": ""}
        if user_input is not None:
            try:
                policy = Policy.from_text(user_input.get(CONF_PREVIEW_HOSTS, ""))
            except ValueError as err:
                errors[CONF_PREVIEW_HOSTS] = "invalid_host"
                placeholders["entry"] = str(err)
            else:
                return self.async_create_entry(data={CONF_PREVIEW_HOSTS: "\n".join(policy.entries)})
        return self.async_show_form(
            step_id="init",
            data_schema=self.add_suggested_values_to_schema(
                OPTIONS_SCHEMA, user_input or self.config_entry.options
            ),
            errors=errors,
            description_placeholders=placeholders,
        )
