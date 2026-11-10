import java.io.File;
import java.io.FileOutputStream;
import java.lang.reflect.Method;
import org.junit.platform.engine.TestSource;
import org.junit.platform.engine.support.descriptor.ClassSource;
import org.junit.platform.engine.TestExecutionResult;
import org.junit.platform.launcher.TestExecutionListener;
import org.junit.platform.launcher.TestIdentifier;
import org.junit.platform.launcher.TestPlan;

public class RecognizerListener implements TestExecutionListener {
    private final File folder;

    public RecognizerListener() {
        String dumps = System.getProperty("recognizer.dumps");
        String project = System.getProperty("recognizer.project", ":");
        String name = project.equals(":") ? "~" : project.replace(':', '~');
        this.folder = dumps == null ? null : new File(new File(dumps), name);
    }

    private static byte[] take() {
        try {
            Class<?> runtime = Class.forName("org.jacoco.agent.rt.RT");
            Object agent = runtime.getMethod("getAgent").invoke(null);
            Method data = agent.getClass().getMethod("getExecutionData", boolean.class);
            data.setAccessible(true);
            return (byte[]) data.invoke(agent, true);
        } catch (Throwable error) {
            return null;
        }
    }

    @Override
    public void testPlanExecutionStarted(TestPlan plan) {
        if (folder != null) {
            take();
        }
    }

    @Override
    public void executionFinished(TestIdentifier identifier, TestExecutionResult result) {
        if (folder == null || !identifier.isContainer()) {
            return;
        }

        TestSource source = identifier.getSource().orElse(null);

        if (!(source instanceof ClassSource)) {
            return;
        }

        String name = ((ClassSource) source).getClassName();

        if (name.indexOf('$') >= 0) {
            return;
        }

        byte[] data = take();

        if (data == null) {
            return;
        }

        try {
            folder.mkdirs();

            try (FileOutputStream out = new FileOutputStream(new File(folder, name + ".exec"))) {
                out.write(data);
            }
        } catch (Exception error) {
            return;
        }
    }
}
