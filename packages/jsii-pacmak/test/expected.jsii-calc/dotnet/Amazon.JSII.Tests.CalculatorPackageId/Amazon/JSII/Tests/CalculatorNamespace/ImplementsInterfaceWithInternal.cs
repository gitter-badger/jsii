using Amazon.JSII.Runtime.Deputy;

namespace Amazon.JSII.Tests.CalculatorNamespace
{
    /// <remarks>
    /// stability: Experimental
    /// </remarks>
    [JsiiClass(nativeType: typeof(Amazon.JSII.Tests.CalculatorNamespace.ImplementsInterfaceWithInternal), fullyQualifiedName: "jsii-calc.ImplementsInterfaceWithInternal")]
    public class ImplementsInterfaceWithInternal : DeputyBase, Amazon.JSII.Tests.CalculatorNamespace.IInterfaceWithInternal
    {
        public ImplementsInterfaceWithInternal(): base(new DeputyProps(new object[]{}))
        {
        }

        protected ImplementsInterfaceWithInternal(ByRefValue reference): base(reference)
        {
        }

        protected ImplementsInterfaceWithInternal(DeputyProps props): base(props)
        {
        }

        /// <remarks>
        /// stability: Experimental
        /// </remarks>
        [JsiiMethod(name: "visible", isOverride: true)]
        public virtual void Visible()
        {
            InvokeInstanceVoidMethod(new object[]{});
        }
    }
}
