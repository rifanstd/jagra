package dev.jagra.sample.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import dev.jagra.sample.R
import dev.jagra.sample.SaveState
import dev.jagra.sample.data.Item
import dev.jagra.sample.ui.theme.LocalTokens

// The planted bug (SMP-4): Save disappears when the name is longer than this. Leave it in,
// the sample's save-item flow is meant to fail here. See sample-app/README.md.
private const val SAVE_BUTTON_NAME_LIMIT = 20

@Composable
fun ItemDetailScreen(
    item: Item,
    saveState: SaveState,
    onEdit: () -> Unit,
    onSave: (Item) -> Unit,
    onBack: () -> Unit,
) {
    var name by rememberSaveable(item.id) { mutableStateOf(item.name) }
    var quantity by rememberSaveable(item.id) { mutableStateOf(item.quantity.toString()) }

    Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
        Column(
            Modifier
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(start = 16.dp, end = 16.dp, bottom = 16.dp),
        ) {
            // Orange is for the main action only (design/system/README.md), so Back uses the text color.
            TextButton(
                onClick = onBack,
                colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.onBackground),
                modifier = Modifier.padding(top = 8.dp),
            ) {
                Text(stringResource(R.string.detail_back))
            }
            Text(
                item.name,
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(vertical = 4.dp),
            )
            Text(
                item.description,
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.padding(bottom = 20.dp),
            )
            Panel(Modifier.fillMaxWidth()) {
                Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Field(
                        label = stringResource(R.string.detail_name),
                        value = name,
                        onValueChange = {
                            name = it
                            onEdit()
                        },
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                    )
                    Field(
                        label = stringResource(R.string.detail_quantity),
                        value = quantity,
                        onValueChange = { typed ->
                            quantity = typed.filter(Char::isDigit).take(6)
                            onEdit()
                        },
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Number,
                            imeAction = ImeAction.Done,
                        ),
                    )
                    if (name.length <= SAVE_BUTTON_NAME_LIMIT) {
                        MainButton(
                            stringResource(R.string.detail_save),
                            enabled = name.isNotBlank() &&
                                quantity.isNotEmpty() &&
                                saveState != SaveState.Saving,
                            onClick = {
                                onSave(item.copy(name = name.trim(), quantity = quantity.toInt()))
                            },
                        )
                    }
                    SaveMessage(saveState)
                }
            }
        }
    }
}

@Composable
private fun SaveMessage(state: SaveState) {
    when (state) {
        SaveState.Idle -> Unit
        SaveState.Saving -> Text(stringResource(R.string.detail_saving))
        SaveState.Saved -> Text(
            stringResource(R.string.detail_saved),
            color = LocalTokens.current.success,
            fontWeight = FontWeight.SemiBold,
        )
        SaveState.Failed -> ErrorLine(stringResource(R.string.detail_save_failed))
    }
}
