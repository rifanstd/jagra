package dev.jagra.sample.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import dev.jagra.sample.R

@Composable
fun LoginScreen(onSignIn: (username: String, password: String) -> Boolean) {
    var username by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var wrong by rememberSaveable { mutableStateOf(false) }
    val submit = { wrong = !onSignIn(username, password) }

    Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 24.dp),
        ) {
            Column(Modifier.widthIn(max = 420.dp).fillMaxWidth()) {
                Text(
                    stringResource(R.string.login_title),
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Spacer(Modifier.height(4.dp))
                Text(stringResource(R.string.login_subtitle), style = MaterialTheme.typography.bodyLarge)
                Spacer(Modifier.height(24.dp))
                Panel(Modifier.fillMaxWidth()) {
                    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        Field(
                            label = stringResource(R.string.login_username),
                            value = username,
                            onValueChange = { username = it; wrong = false },
                            isError = wrong,
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                        )
                        Field(
                            label = stringResource(R.string.login_password),
                            value = password,
                            onValueChange = { password = it; wrong = false },
                            isError = wrong,
                            visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Password,
                                imeAction = ImeAction.Done,
                            ),
                            keyboardActions = KeyboardActions(onDone = { submit() }),
                        )
                        if (wrong) ErrorLine(stringResource(R.string.login_wrong))
                        MainButton(stringResource(R.string.login_sign_in), onClick = submit)
                    }
                }
                Spacer(Modifier.height(16.dp))
                Text(stringResource(R.string.login_demo_account), style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

/** A red mark with the message in normal text, so the message stays readable (design/system/README.md). */
@Composable
fun ErrorLine(message: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("✕", color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.SemiBold)
        Text(message, style = MaterialTheme.typography.bodyMedium)
    }
}
